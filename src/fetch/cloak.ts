/**
 * CloakBrowser fallback (operator-gated): when a normal download is blocked by
 * Cloudflare/WAF (HTTP 403/429 or a non-PDF interstitial), retry the URL through
 * CloakBrowser — a source-level-fingerprint-patched stealth Chromium that passes
 * the challenge (drop-in Playwright replacement, `cloakbrowser` npm package).
 *
 * Flow: launch a headless browser, navigate to the URL's origin (so the
 * challenge cookie is set), then run an in-page `fetch()` for the target
 * (carries the real browser fingerprint + cookies) and return the bytes.
 * Re-validated by the caller (`%PDF` + size). Best-effort: fails closed
 * (`{ ok:false, detail }`).
 *
 * This module is lazy — `cloakbrowser` (and its Chromium binary) are only
 * touched when a cloaked fetch is actually attempted. The binary auto-downloads
 * (~200 MB, cached in `~/.cloakbrowser/`; override with `CLOAKBROWSER_CACHE_DIR`).
 * Its own downloader uses Node's global `fetch`, which ignores proxy env vars —
 * so when the operator configures a proxy we route that download through it too.
 * @module dsh-scholar-find/cloak
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from 'undici'
import { sleep } from '../util/async.js'

/** Cap on how long the challenge-clear poll runs before giving up. */
const CHALLENGE_CLEAR_MAX_MS = 40_000
/** Delay between challenge-clear polls. */
const CHALLENGE_POLL_MS = 1000
/** `networkidle` wait after the challenge clears. */
const CHALLENGE_NETWORKIDLE_MS = 10_000
/** Delay before retrying an evaluate that a late navigation tore down. */
const EVAL_RETRY_DELAY_MS = 2000
/** Page titles that indicate the interstitial has NOT cleared yet. */
const CHALLENGE_TITLE_MARKERS = /Just a moment|Loading|DDoS-Guard|Verification|robot/i

/** In-page fetch: stream the body up to `cap` bytes, base64 back. */
const FETCH_JS = /* @__PURE__ */ ((arg: unknown) => {
  const [u, cap] = arg as [string, number]
  return (async () => {
    const r = await fetch(u, { credentials: 'include' })
    if (r.status !== 200 || !r.body) return { status: r.status, b64: '' }
    const reader = r.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) {
        try { await reader.cancel() } catch { /* ignore */ }
        return { status: r.status, oversized: true, b64: '' }
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength }
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
    return { status: r.status, b64: btoa(bin) }
  })()
})

export interface CloakResult {
  ok: boolean
  bytes?: Uint8Array
  status?: number
  detail?: string
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = Buffer.from(b64, 'base64')
  return new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)
}

/** Ensure the proxy string has the `http://` scheme cloakbrowser's parser needs. */
function normalizeProxy(value: string): string {
  const v = value.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`
}

/** Shared browser flow: launch (+ proxy dispatcher swap for the binary
 * download), clear the origin's bot challenge, then in-page `fetch()` `url` and
 * return the raw bytes. The in-page fetch caps the body at `maxBytes` (the
 * operator's configured PDF size limit — the same cap the direct path applies),
 * so a cloak response can never exceed the configured size either. */
async function cloakFetchRaw(url: string, timeoutMs: number, maxBytes: number, proxyUrl?: string): Promise<CloakResult> {
  // Default the browser cache to a real home dir; env override wins.
  process.env.CLOAKBROWSER_CACHE_DIR ||= join(homedir(), '.cloakbrowser')

  let cloak: typeof import('cloakbrowser')
  try {
    cloak = await import('cloakbrowser')
  } catch (e) {
    return { ok: false, detail: `cloakbrowser unavailable: ${(e as Error).message}` }
  }

  // CloakBrowser's binary download (and its signed-manifest fetch) uses Node's
  // global `fetch`, which ignores HTTP(S)_PROXY. Route it through the operator's
  // proxy so a fresh download works behind a firewall/GFW. The browser's own
  // networking is separately configured via the launch `proxy` option. The
  // global dispatcher is swapped only for the duration of `launch()` (the binary
  // download completes before it resolves) and restored afterwards.
  const proxy = proxyUrl?.trim() ? normalizeProxy(proxyUrl) : undefined
  let prevDispatcher: unknown
  let downloadAgent: ProxyAgent | undefined
  if (proxy) {
    prevDispatcher = getGlobalDispatcher()
    try {
      downloadAgent = new ProxyAgent(proxy)
      setGlobalDispatcher(downloadAgent)
    } catch (e) {
      return { ok: false, detail: `cloak proxy setup failed: ${(e as Error).message}` }
    }
  }

  let browser: Awaited<ReturnType<typeof cloak.launch>>
  try {
    browser = await cloak.launch({ headless: true, ...(proxy ? { proxy } : {}) })
  } catch (e) {
    return { ok: false, detail: `cloak launch failed: ${(e as Error).message}` }
  } finally {
    if (prevDispatcher !== undefined) {
      setGlobalDispatcher(prevDispatcher as ReturnType<typeof getGlobalDispatcher>)
      void downloadAgent?.close().catch(() => {})
    }
  }

  try {
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      return { ok: false, detail: 'cloak: invalid target URL' }
    }
    const ctx = await browser.newContext({ acceptDownloads: false })
    const page = await ctx.newPage()
    // Clear the origin's bot challenge so the in-page fetch carries the cleared
    // cookie. best-effort; some challenges need a headed window.
    try {
      await page.goto(`${origin}/`, { timeout: timeoutMs, waitUntil: 'domcontentloaded' })
    } catch (e) {
      // origin navigation may still be partial; proceed to poll for clearance
    }
    // Poll until the Cloudflare/DataDome/DDoS-Guard interstitial clears: the
    // challenge shows "Just a moment…"/"DDoS-Guard"/"Loading" before the real
    // page. Treat those as not-ready; the deadline caps the wait.
    const deadline = Date.now() + Math.min(timeoutMs, CHALLENGE_CLEAR_MAX_MS)
    let title = ''
    while (Date.now() < deadline) {
      title = await page.title().catch(() => '')
      if (title && !CHALLENGE_TITLE_MARKERS.test(title)) break
      await sleep(CHALLENGE_POLL_MS)
    }
    await page.waitForLoadState('networkidle', { timeout: CHALLENGE_NETWORKIDLE_MS }).catch(() => {})
    await sleep(CHALLENGE_POLL_MS) // settle late-loading JS / redirects
    // In-page fetch from the cleared page so the request carries the browser's
    // real fingerprint + cleared cookie. Retry once if a late navigation tears
    // down the execution context mid-evaluate.
    let res: { status: number; b64?: string; oversized?: boolean } | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await page.evaluate(FETCH_JS, [url, maxBytes])
        break
      } catch (e) {
        if (attempt === 0) await sleep(EVAL_RETRY_DELAY_MS)
        else return { ok: false, status: undefined, detail: `cloak fetch failed: ${(e as Error).message}` }
      }
    }
    if (!res || res.oversized) return { ok: false, detail: res?.oversized ? `response exceeds ${maxBytes} bytes` : 'no result' }
    if (res.status !== 200 || !res.b64) return { ok: false, status: res.status, detail: `in-page fetch returned HTTP ${res.status}` }
    return { ok: true, status: res.status, bytes: base64ToBytes(res.b64) }
  } catch (e) {
    return { ok: false, detail: `cloak fetch failed: ${(e as Error).message}` }
  } finally {
    await browser.close().catch(() => {})
  }
}

/**
 * Fetch a PDF through CloakBrowser. Fails closed (`{ ok:false, detail }`) if
 * unavailable or cannot launch; the caller re-validates `%PDF` + size.
 * `maxBytes` is the operator-configured PDF size cap — a cloaked response over
 * it is rejected here rather than buffered in the browser.
 */
export async function cloakFetchPdf(url: string, timeoutMs: number, maxBytes: number, proxyUrl?: string): Promise<CloakResult> {
  return cloakFetchRaw(url, timeoutMs, maxBytes, proxyUrl)
}
