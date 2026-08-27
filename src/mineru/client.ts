/**
 * Minimal client for the MinerU **Agent 轻量解析 API** — a keyless (IP-limited)
 * async document parser that converts a single PDF (URL or local file) to
 * Markdown full text. It is submit → poll → download:
 *
 *  - URL mode: `POST /api/v1/agent/parse/url` with `{ url }` → task_id → poll.
 *  - File mode: `POST /api/v1/agent/parse/file` with `{ file_name }` → task_id +
 *    an OSS signed `file_url` → PUT the file bytes to `file_url` → poll.
 *  - Poll: `GET /api/v1/agent/parse/{task_id}`; when `state=done`,
 *    `data.markdown_url` is the CDN link to `full.md`.
 *
 * All traffic goes through `pluginFetch` (proxy + browser UA). Errors carry
 * `code` + `data.err_msg`/`err_code`. The plugin only uses the lightweight
 * (no-token) agent endpoints; no API key is required.
 * @module dsh-scholar-find/mineru
 */

import { readFile } from 'node:fs/promises'
import { pluginFetch } from '../fetch/transport.js'

const MINERU_BASE = 'https://mineru.net'
const PARSE_URL = `${MINERU_BASE}/api/v1/agent/parse/url`
const PARSE_FILE = `${MINERU_BASE}/api/v1/agent/parse/file`
const POLL_INTERVAL_MS = 3000
/** Default poll timeout (the lightweight model can take a while). */
export const MINERU_TIMEOUT_MS = 300_000
/** The lightweight API limits files to 10 MB. */
export const MINERU_MAX_BYTES = 10 * 1024 * 1024

interface MineruEnvelope {
  code: number
  msg?: string
  trace_id?: string
  data?: {
    task_id?: string
    state?: string
    markdown_url?: string
    file_url?: string
    err_msg?: string
    err_code?: number
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function json<T = MineruEnvelope>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new Error(`mineru: non-JSON response (HTTP ${res.status})`)
  }
}

async function postJson(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<MineruEnvelope> {
  const res = await pluginFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw new Error(`mineru: submit HTTP ${res.status}`)
  const env = await json(res)
  if (env.code !== 0) throw new Error(`mineru: ${env.msg ?? env.data?.err_msg ?? 'submit failed'}`)
  return env
}

/** Poll task `taskId` until `done`; returns the Markdown CDN link. */
async function pollTask(taskId: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const url = `${MINERU_BASE}/api/v1/agent/parse/${taskId}`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await pluginFetch(url, { headers: { accept: 'application/json' }, signal })
    if (!res.ok) throw new Error(`mineru: poll HTTP ${res.status}`)
    const env = await json(res)
    if (env.code !== 0) throw new Error(`mineru: ${env.msg ?? 'poll failed'}`)
    const state = env.data?.state
    if (state === 'done') {
      const md = env.data?.markdown_url
      if (!md) throw new Error('mineru: done but no markdown_url')
      return md
    }
    if (state === 'failed') throw new Error(`mineru: ${env.data?.err_msg ?? 'parse failed'}${env.data?.err_code ? ` (${env.data.err_code})` : ''}`)
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error('mineru: poll timeout')
}

async function fetchMarkdown(url: string, signal?: AbortSignal): Promise<string> {
  const res = await pluginFetch(url, { signal })
  if (!res.ok) throw new Error(`mineru: markdown download HTTP ${res.status}`)
  return res.text()
}

/** Parse a remote PDF/file URL to Markdown. */
export async function mineruParseUrl(url: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ markdown: string }> {
  const env = await postJson(PARSE_URL, { url }, opts.signal)
  const taskId = env.data?.task_id
  if (!taskId) throw new Error('mineru: no task_id returned')
  const markdownUrl = await pollTask(taskId, opts.timeoutMs ?? MINERU_TIMEOUT_MS, opts.signal)
  return { markdown: await fetchMarkdown(markdownUrl, opts.signal) }
}

/** Parse a local PDF file to Markdown (signature-upload: submit → PUT → poll). */
export async function mineruParseFile(path: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ markdown: string }> {
  const bytes = await readFile(path)
  if (bytes.length > MINERU_MAX_BYTES) throw new Error(`mineru: file exceeds the 10 MB lightweight limit`)
  const fileName = path.split(/[\\/]/).pop() || 'paper.pdf'
  const env = await postJson(PARSE_FILE, { file_name: fileName }, opts.signal)
  const taskId = env.data?.task_id
  const fileUrl = env.data?.file_url
  if (!taskId || !fileUrl) throw new Error('mineru: no task_id / file_url returned')
  // Upload the raw bytes to the OSS signed URL (no Authorization header).
  const put = await pluginFetch(fileUrl, { method: 'PUT', body: bytes as unknown as BodyInit, signal: opts.signal })
  if (!put.ok) throw new Error(`mineru: file upload HTTP ${put.status}`)
  const markdownUrl = await pollTask(taskId, opts.timeoutMs ?? MINERU_TIMEOUT_MS, opts.signal)
  return { markdown: await fetchMarkdown(markdownUrl, opts.signal) }
}
