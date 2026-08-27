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

/**
 * Fetch a PDF through CloakBrowser. Lazy-imports `cloakbrowser`; fails closed
 * (returns `{ ok:false, detail }`) if it is unavailable or cannot launch.
 * @param url - the PDF URL to fetch in-page on the same origin.
 * @param timeoutMs - per-step timeout.
 */
export async function cloakFetchPdf(url: string, timeoutMs: number): Promise<CloakResult> {
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
    browser = await cloak.launch({ headless: true })
  } catch (e) {
    return { ok: false, detail: `cloak launch failed: ${(e as Error).message}` }
  }

  try {
    const { origin } = new URL(url)
    const ctx = await browser.newContext({ acceptDownloads: false })
    const page = await ctx.newPage()
    // Clear the origin's Cloudflare challenge so the in-page fetch carries the
    // cf_clearance cookie. best-effort; some challenges need a headed window.
    try {
      await page.goto(`${origin}/`, { timeout: timeoutMs, waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 10_000) }).catch(() => {})
    } catch (e) {
      // origin navigation may still be partial; proceed to the in-page fetch
    }
    const res = await page.evaluate(FETCH_JS, [url, MAX_PDF_SIZE])
    if (!res || res.oversized) return { ok: false, detail: res?.oversized ? 'response exceeds 50 MB' : 'no result' }
    if (res.status !== 200 || !res.b64) return { ok: false, detail: `in-page fetch returned HTTP ${res.status}` }
    return { ok: true, bytes: base64ToBytes(res.b64) }
  } catch (e) {
    return { ok: false, detail: `cloak fetch failed: ${(e as Error).message}` }
  } finally {
    await browser.close().catch(() => {})
  }
}

/** Whether the operator has opted into the cloak fallback. */
export function isCloakEnabled(enabled: boolean): boolean {
  return Boolean(enabled)
}