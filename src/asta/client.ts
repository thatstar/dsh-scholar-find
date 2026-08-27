/**
 * Minimal client for the Ai2 **Asta Scientific Corpus Tools** MCP server
 * (`https://asta-tools.allen.ai/mcp/v1`) — the Semantic Scholar owner's corpus
 * with full-text content that the public S2 Graph API doesn't expose. This
 * plugin consumes exactly one of its tools: `snippet_search`, which returns
 * ~500-word content snippets drawn from a paper's title, abstract, and body
 * text (excerpts about 500 words), optionally restricted to specific papers.
 *
 * Transport: Streamable HTTP carrying JSON-RPC 2.0. The server is stateless —
 * a single `tools/call` POST (no `initialize`/session) works, authenticated via
 * the `x-api-key` header. Responses are SSE (`event: message` / `data: {...}`)
 * or plain JSON; both are parsed here. Requests go through the plugin's
 * `pluginFetch` so the configured proxy (and browser UA) apply.
 * @module dsh-scholar-find/asta
 */

import { pluginFetch } from '../fetch/transport.js'

/** Ai2 Asta MCP endpoint. */
export const ASTA_ENDPOINT = 'https://asta-tools.allen.ai/mcp/v1'
/** Default per-request timeout (snippet search over full text can be slow). */
export const ASTA_TIMEOUT_MS = 60_000
/** How many snippets snippet_search returns by default. */
export const ASTA_DEFAULT_LIMIT = 1

interface JSONRpcResponse {
  jsonrpc: '2.0'
  id?: number | string
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** A snippet result from snippet_search, with the paper it came from. */
export interface AstaSnippet {
  score?: number
  paper?: {
    corpusId?: string
    title?: string
    authors?: string[]
    openAccessInfo?: { license?: string; status?: string }
  }
  snippet?: {
    text: string
    snippetKind?: string
    section?: string | null
  }
}

/**
 * Parse a JSON-RPC envelope from an SSE (`event: message\ndata: {...}`) or a
 * plain JSON response body.
 */
function parseEnvelope(body: string): JSONRpcResponse | undefined {
  // SSE: every `data:` line is a JSON payload; return the first that parses.
  const dataLines = body.match(/^data:\s*(.+)$/gm)
  if (dataLines) {
    for (const line of dataLines) {
      try {
        const parsed = JSON.parse(line.replace(/^data:\s*/, '')) as JSONRpcResponse
        if (parsed) return parsed
      } catch {
        // not JSON — skip to the next data line
      }
    }
  }
  try {
    return JSON.parse(body) as JSONRpcResponse
  } catch {
    return undefined
  }
}

/**
 * Read a JSON-RPC envelope from a response. For `text/event-stream` the server
 * keeps the SSE stream open after sending the result, so we read incrementally
 * and resolve on the FIRST `result`/`error` event (then cancel the stream). For
 * plain JSON we read the whole body and parse it.
 */
async function readEnvelope(res: Response): Promise<JSONRpcResponse | undefined> {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/event-stream')) {
    return parseEnvelope(await res.text())
  }
  const reader = res.body?.getReader()
  if (!reader) return undefined
  const decoder = new TextDecoder()
  let buf = ''
  const tryParse = async (eventBlock: string): Promise<JSONRpcResponse | undefined> => {
    const dataLine = eventBlock.split('\n').find((l) => l.startsWith('data:'))
    if (!dataLine) return undefined
    try {
      const parsed = JSON.parse(dataLine.slice(5).trim()) as JSONRpcResponse
      if (parsed?.result !== undefined || parsed?.error) {
        await reader.cancel().catch(() => {})
        return parsed
      }
    } catch {
      // not JSON — keep reading
    }
    return undefined
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // Events are blank-line delimited; process the complete ones, keep the tail.
      const events = buf.split('\n\n')
      buf = events.pop() ?? ''
      for (const evt of events) {
        const parsed = await tryParse(evt)
        if (parsed) return parsed
      }
    }
  } catch {
    // stream aborted — fall through and try the buffered tail as plain JSON
  }
  return parseEnvelope(buf)
}

/** One JSON-RPC call to the Asta MCP endpoint. Returns `result` (throws on `error`). */
async function astaCall(
  apiKey: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('asta timeout')), timeoutMs)
  try {
    const res = await pluginFetch(ASTA_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json, text/event-stream',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 0x7fffffff, method, params }),
      signal: controller.signal,
    })
    const envelope = await readEnvelope(res)
    if (!envelope) throw new Error(`asta: non-JSON-RPC response (HTTP ${res.status})`)
    if (envelope.error) throw new Error(`asta: ${envelope.error.message}`)
    return envelope.result
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Call the Asta `snippet_search` tool and return the parsed snippets (paper +
 * ~500-word content). `args` keys match the MCP tool: `query` (required),
 * `paper_ids`, `limit`, `venues`, `inserted_before`.
 */
export async function astaSnippetSearch(
  apiKey: string,
  args: { query: string; paper_ids?: string; limit?: number; venues?: string; inserted_before?: string },
  timeoutMs: number = ASTA_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<AstaSnippet[]> {
  const result = (await astaCall(apiKey, 'tools/call', { name: 'snippet_search', arguments: args }, timeoutMs, signal)) as {
    content?: Array<{ type?: string; text?: string }>
    structuredContent?: { result?: { data?: AstaSnippet[] } }
    isError?: boolean
  } | undefined
  if (result?.isError) throw new Error(`asta: snippet_search failed`)
  // Preferred: the structuredContent path (richest).
  const structured = result?.structuredContent?.result?.data
  if (Array.isArray(structured)) return structured
  // Fallback: the tool result is `content[{ type:'text', text: JSON... }]`.
  const text = result?.content?.[0]?.text
  if (typeof text === 'string') {
    try {
      const parsed = JSON.parse(text) as { data?: AstaSnippet[] }
      if (Array.isArray(parsed.data)) return parsed.data
    } catch {
      // not JSON — fall through
    }
  }
  throw new Error('asta: snippet_search returned no data')
}
