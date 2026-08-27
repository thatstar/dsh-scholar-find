/**
 * Shared outbound transport for the plugin: a browser User-Agent on every
 * request (several OA hosts 403 `node`/default UAs even on open PDFs) and an
 * optional HTTP proxy via an undici `ProxyAgent` passed as the `dispatcher`.
 *
 * Only the plugin's own requests use the proxy/UA — the harness's own traffic
 * is untouched (no global dispatcher override). A proxy URL comes from the
 * `proxyUrl` plugin setting, falling back to the standard HTTPS_PROXY /
 * HTTP_PROXY / ALL_PROXY environment variables.
 * @module dsh-scholar-find/fetch-transport
 */

import { ProxyAgent } from 'undici'

/** Modern browser UA used by default for all outbound requests. */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

let proxyAgent: ProxyAgent | undefined

/** Normalise a proxy URL: add http:// when only a host:port was given. */
export function normalizeProxyUrl(value: string): string {
  return /^https?:\/\//.test(value) ? value : `http://${value}`
}

/**
 * Resolve the proxy URL: plugin setting first, then the standard proxy env vars.
 * @param setting - the `proxyUrl` settings value (may be empty).
 */
export function resolveProxyUrl(setting: string | undefined): string | undefined {
  const s = setting?.trim()
  if (s) return normalizeProxyUrl(s)
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY
}

/**
 * Configure the outbound proxy. Call with an empty/undefined value to disable
 * the proxy. The dispatcher is applied only to requests made through this
 * module.
 * @param proxy - a proxy URL (or undefined to disable).
 */
export function configureProxy(proxy?: string): void {
  const url = proxy?.trim()
  if (!url) {
    proxyAgent = undefined
    return
  }
  proxyAgent?.close?.()
  proxyAgent = new ProxyAgent(normalizeProxyUrl(url))
}

/**
 * The plugin's own fetch: sends the browser UA (unless the caller already set
 * one) and routes through the configured proxy dispatcher. The global native
 * `fetch` is undici-backed and honors a `dispatcher` field in the init.
 */
export async function pluginFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string> | undefined) ?? {}) }
  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'user-agent')) {
    headers['User-Agent'] = BROWSER_UA
  }
  const requestInit: RequestInit = { ...init, headers }
  if (proxyAgent) {
    ;(requestInit as RequestInit & { dispatcher: ProxyAgent }).dispatcher = proxyAgent
  }
  return fetch(url, requestInit)
}