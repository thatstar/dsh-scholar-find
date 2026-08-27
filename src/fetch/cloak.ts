/**
 * CloakBrowser fallback (operator-gated): when a normal download is blocked by
 * Cloudflare/WAF (HTTP 403/429 or a non-PDF interstitial), retry the URL through
 * CloakBrowser — a source-level-fingerprint-patched stealth Chromium that passes
 * the challenge (drop-in Playwright replacement, `cloakbrowser` npm package).
 *
 * Flow mirrors the reference tool: launch a headless browser, navigate to the
 * PDF host's origin (so the `cf_clearance` cookie is set), then run an in-page
 * `fetch()` for the PDF (carries the real browser fingerprint + cookies) and
 * return the bytes. Re-validated by the caller (`%PDF` + size). Best-effort:
 * returns `{ ok: false, detail }` on any failure (fails closed).
 *
 * This module is lazy — `cloakbrowser` (and its Chromium binary) are only
 * touched when a cloaked download is actually attempted. The binary
 * auto-downloads (~200 MB, cached in `~/.cloakbrowser/`; override with
 * `CLOAKBROWSER_CACHE_DIR`).
 * @module dsh-scholar-find/cloak
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

const MAX_PDF_SIZE = 50 * 1024 * 1024

/** In-page fetch: stream the PDF up to `cap` bytes, base64 back. */
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

/**
 * Fetch a PDF through CloakBrowser. Lazy-imports `cloakbrowser`; fails closed
 * (returns `{ ok:false, detail }`) if it is unavailable or cannot launch.
 * @param url - the PDF URL to fetch in-page on the same origin.
 * @param timeoutMs - per-step timeout.
 * @param proxyUrl - optional proxy (e.g. `http://127.0.0.1:10808`) routed
 *   through the CloakBrowser's own network stack; unset means direct. Required
 *   where the PDF host is only reachable via a proxy (GFW).
 */
export async function cloakFetchPdf(url: string, timeoutMs: number, proxyUrl?: string): Promise<CloakResult> {
  // Default the browser cache to a real home dir; env override wins.
  process.env.CLOAKBROWSER_CACHE_DIR ||= join(homedir(), '.cloakbrowser')

  let cloak: typeof import('cloakbrowser')
  try {
    cloak = await import('cloakbrowser')
  } catch (e) {
    return { ok: false, detail: `cloakbrowser unavailable: ${(e as Error).message}` }
  }

  let browser: Awaited<ReturnType<typeof cloak.launch>>
  try {
    const proxy = proxyUrl?.trim() ? normalizeProxy(proxyUrl) : undefined
    browser = await cloak.launch({ headless: true, ...(proxy ? { proxy } : {}) })
  } catch (e) {
    return { ok: false, detail: `cloak launch failed: ${(e as Error).message}` }
  }

  try {
    const { origin } = new URL(url)
    const ctx = await browser.newContext({ acceptDownloads: false })
    const page = await ctx.newPage()
    // Clear the origin's bot challenge so the in-page fetch carries the cleared
    // cookie. best-effort; some challenges need a headed window.
    try {
      await page.goto(`${origin}/`, { timeout: timeoutMs, waitUntil: 'domcontentloaded' })
    } catch (e) {
      // origin navigation may still be partial; proceed to poll for clearance
    }
    // Poll until the Cloudflare/DataDome interstitial clears: the challenge
    // shows "Just a moment…" then a transitional "Loading" title before the
    // real page. Treat both as not-ready. Deadline mirrors the reference tool.
    const deadline = Date.now() + Math.min(timeoutMs, 40_000)
    let title = ''
    while (Date.now() < deadline) {
      title = await page.title().catch(() => '')
      if (title && !title.includes('Just a moment') && !title.startsWith('Loading')) break
      await sleep(1000)
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
    await sleep(1000) // settle late-loading JS / redirects
    // In-page fetch from the cleared page so the request carries the browser's
    // real fingerprint + cleared cookie. Retry once if a late navigation tears
    // down the execution context mid-evaluate.
    let res: { status: number; b64?: string; oversized?: boolean } | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await page.evaluate(FETCH_JS, [url, MAX_PDF_SIZE])
        break
      } catch (e) {
        if (attempt === 0) await sleep(2000)
        else throw e
      }
    }
    if (!res || res.oversized) return { ok: false, detail: res?.oversized ? 'response exceeds 50 MB' : 'no result' }
    if (res.status !== 200 || !res.b64) return { ok: false, detail: `in-page fetch returned HTTP ${res.status}` }
    return { ok: true, bytes: base64ToBytes(res.b64) }
  } catch (e) {
    return { ok: false, detail: `cloak fetch failed: ${(e as Error).message}` }
  } finally {
    await browser.close().catch(() => {})
  }
}

/** Promise-based setTimeout for the challenge-clear polling loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Whether the operator has opted into the cloak fallback. */
export function isCloakEnabled(enabled: boolean): boolean {
  return Boolean(enabled)
}