/**
 * Facade over the official `sciverse` TypeScript SDK (AgentToolsClient) for the
 * Sciverse Open Platform academic-retrieval APIs.
 *
 * House rules applied here:
 *  - the Bearer token comes from the DSH credentials domain (never settings);
 *  - every call is bounded by a wall-clock timeout (`withTimeout` — the SDK
 *    accepts no AbortSignal);
 *  - NO proxy: Sciverse is a China-hosted service and is intentionally fetched
 *    DIRECTLY (documented in AGENTS.md); no undici dispatcher swap occurs here.
 *
 * The SDK value import comes from the esbuild bundle (`./sdk.bundle.js`) — the
 * published `sciverse` entry uses extensionless ESM imports that plain Node
 * cannot resolve (see src/sciverse/sdk.ts and scripts/build-sciverse.mjs).
 * @module dsh-scholar-find/sciverse
 */

import { AgentToolsClient } from './sdk.bundle.js'
import type { AgentToolsClientOptions } from './sdk.bundle.js'
import { withTimeout } from '../util/async.js'

/** One call on any of the six Sciverse tools, timeout-bounded. */
export class SciverseClient {
  private readonly client: AgentToolsClient
  private readonly timeoutMs: number

  constructor(token: string, timeoutMs: number, baseUrl?: string) {
    const options: AgentToolsClientOptions = { token }
    if (baseUrl) options.baseUrl = baseUrl
    this.client = new AgentToolsClient(options)
    this.timeoutMs = timeoutMs
  }

  private run<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return withTimeout(fn(), this.timeoutMs, `sciverse ${label}`)
  }

  /** Structured metadata search over papers/authors/sources. */
  searchPapers(args: Record<string, unknown>): Promise<unknown> {
    return this.run('search_papers', () => this.client.searchPapers(args))
  }

  /** Natural-language semantic retrieval over passages (RAG chunks). */
  semanticSearch(args: { query: string } & Record<string, unknown>): Promise<unknown> {
    return this.run('semantic_search', () => this.client.semanticSearch(args))
  }

  /** Discover search_papers fields, filter operators, and enum samples. */
  listCatalog(args: { include_sample_values?: boolean; include_field_stats?: boolean; collection?: string } = {}): Promise<unknown> {
    return this.run('list_catalog', () => this.client.listCatalog(args))
  }

  /** Paginate a paper's citations / references / related works. */
  listPaperRelations(args: { unique_id: string; relation: string; page?: number; page_size?: number }): Promise<unknown> {
    return this.run('list_paper_relations', () => this.client.listPaperRelations(args))
  }

  /** Byte-range slice of a paper's full text (extend RAG context). */
  readContent(args: { doc_id: string; offset?: number; limit?: number }): Promise<unknown> {
    return this.run('read_content', () => this.client.readContent(args))
  }

  /** Figure/table image bytes referenced inside read_content Markdown. */
  getResource(args: { file_name: string }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return this.run('get_resource', () => this.client.getResource(args))
  }
}

/** Create the facade for the six sciverse_* tools (token required; the caller
 * guards on the configured DSH credential first). */
export function createSciverseClient(token: string, timeoutMs: number): SciverseClient {
  return new SciverseClient(token, timeoutMs)
}