/**
 * Download-layer safety for the paper_fetch tools: SSRF gate, `%PDF` magic
 * check, size cap, and a redirect walk that re-validates every hop.
 * Independent TypeScript implementation of the documented safety
 * requirements (no code from the reference repos).
 * @module dsh-scholar/fetch-safety
 */

import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.aws.internal',
  'metadata',
])

/** Reasons one URL was refused. */
export type SafetyReason =
  | 'malformed_url'
  | 'scheme_not_allowed'
  | 'port_not_allowed'
  | 'empty_host'
  | 'blocked_host'
  | 'private_ip'
  | 'ipv6_literal'
  | 'dns_error'
  | 'dns_private_ip'

/** Syntactic gate: scheme, port, host literal, blocklist. DNS-independent. */
export function isSafeUrl(url: string): { ok: boolean; reason?: SafetyReason } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'malformed_url' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'scheme_not_allowed' }
  }
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { ok: false, reason: 'port_not_allowed' }
  }
  const host = parsed.hostname.toLowerCase()
  if (!host) return { ok: false, reason: 'empty_host' }
  if (BLOCKED_HOSTS.has(host)) return { ok: false, reason: 'blocked_host' }
  // URL.hostname keeps the surrounding brackets for IPv6 literals.
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const ip = isIP(literal)
  if (ip === 4) {
    if (isPrivateIPv4(host)) return { ok: false, reason: 'private_ip' }
  } else if (ip === 6) {
    // Conservative: IPv6 literals are not allowed at all.
    return { ok: false, reason: 'ipv6_literal' }
  }
  return { ok: true }
}

/** Private/loopback/link-local/reserved IPv4 classification. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((s) => Number(s))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 127 || a === 255) return true // 0/8, loopback, broadcast
  if (a === 10) return true // 10/8
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true // 192.168/16
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18/15 benchmarking
  if (a >= 224 && a <= 239) return true // multicast
  if (a >= 240) return true // reserved
  return false
}

/** DNS-resolution gate: every resolved address must be public. */
export async function hostAddrsSafe(host: string): Promise<{ ok: boolean; reason?: SafetyReason }> {
  let addrs: string[]
  try {
    addrs = (await lookup(host, { all: true })).map((a) => a.address)
  } catch {
    return { ok: false, reason: 'dns_error' }
  }
  for (const addr of addrs) {
    if (isIP(addr) === 4 && isPrivateIPv4(addr)) return { ok: false, reason: 'dns_private_ip' }
    if (isIP(addr) === 6) {
      // Reject v6 without deep parsing (e.g. ::1, fe80::, fc00::, fd00::).
      const lower = addr.toLowerCase()
      if (lower === '::1' || lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('::')) {
        return { ok: false, reason: 'dns_private_ip' }
      }
    }
  }
  return { ok: true }
}

/** Full pre-fetch gate: syntax + DNS resolution. */
export async function urlFetchAllowed(url: string): Promise<{ ok: boolean; reason?: SafetyReason }> {
  const s = isSafeUrl(url)
  if (!s.ok) return s
  const host = new URL(url).hostname.toLowerCase()
  const d = await hostAddrsSafe(host)
  return d
}

/** Max redirect hops we will follow until we re-validate. */
export const MAX_REDIRECTS = 5

/**
 * Walk redirects manually (fetch `redirect: 'manual'`), validating every hop
 * through the full gate, and return the terminal response. `checkDns` can be
 * disabled in tests to keep them hermetic.
 */
export async function fetchWithRedirects(
  url: string,
  init: RequestInit,
  opts: { maxRedirects?: number; checkDns?: boolean } = {},
): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= (opts.maxRedirects ?? MAX_REDIRECTS); hop++) {
    const gate = opts.checkDns === false ? isSafeUrl(current) : await urlFetchAllowed(current)
    if (!gate.ok) {
      const err = new Error(`unsafe fetch target ${current}: ${gate.reason}`) as Error & { code?: string }
      err.code = 'host_not_allowed'
      throw err
    }
    const r = await fetch(current, { ...init, redirect: 'manual' })
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get('location')
      if (!location) return r
      current = new URL(location, current).toString()
      continue
    }
    return r
  }
  const err = new Error(`too many redirects from ${url}`) as Error & { code?: string }
  err.code = 'network_error'
  throw err
}

/** True when the bytes start with the `%PDF` magic marker. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/** Read a response body up to `cap` bytes; null when it exceeds the cap. */
export async function readBodyCapped(r: Response, cap: number, signal?: AbortSignal): Promise<Uint8Array | null> {
  if (!r.body) return null
  const reader = r.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > cap) return null
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}