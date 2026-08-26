import { describe, expect, it } from 'vitest'
import { isPrivateIPv4, isSafeUrl, looksLikePdf, readBodyCapped } from '../src/fetch/safety.js'

describe('isPrivateIPv4', () => {
  it('classifies private and special ranges', () => {
    expect(isPrivateIPv4('10.0.0.1')).toBe(true)
    expect(isPrivateIPv4('172.16.0.1')).toBe(true)
    expect(isPrivateIPv4('172.31.255.255')).toBe(true)
    expect(isPrivateIPv4('192.168.1.1')).toBe(true)
    expect(isPrivateIPv4('127.0.0.1')).toBe(true)
    expect(isPrivateIPv4('169.254.1.1')).toBe(true)
    expect(isPrivateIPv4('100.64.0.1')).toBe(true)
    expect(isPrivateIPv4('0.0.0.0')).toBe(true)
    expect(isPrivateIPv4('224.0.0.1')).toBe(true)
    expect(isPrivateIPv4('240.0.0.1')).toBe(true)
    expect(isPrivateIPv4('8.8.8.8')).toBe(false)
    expect(isPrivateIPv4('1.1.1.1')).toBe(false)
    expect(isPrivateIPv4('not-an-ip')).toBe(false)
  })
})

describe('isSafeUrl', () => {
  it('rejects non-http(s) schemes and unsafe ports', () => {
    expect(isSafeUrl('file:///etc/passwd').ok).toBe(false)
    expect(isSafeUrl('ftp://example.com/x.pdf').ok).toBe(false)
    expect(isSafeUrl('gopher://example.com').ok).toBe(false)
    expect(isSafeUrl('http://example.com:8080/x.pdf').ok).toBe(false)
  })

  it('rejects private IP literals, loopback, and metadata hosts', () => {
    expect(isSafeUrl('http://127.0.0.1/x.pdf').reason).toBe('private_ip')
    expect(isSafeUrl('http://10.0.0.5/x.pdf').reason).toBe('private_ip')
    expect(isSafeUrl('http://192.168.0.1/x.pdf').reason).toBe('private_ip')
    expect(isSafeUrl('http://localhost/x.pdf').reason).toBe('blocked_host')
    expect(isSafeUrl('http://metadata.google.internal/x.pdf').reason).toBe('blocked_host')
    expect(isSafeUrl('http://[::1]/x.pdf').reason).toBe('ipv6_literal')
    expect(isSafeUrl('http://[2001:db8::1]/x.pdf').reason).toBe('ipv6_literal')
  })

  it('allows public https URLs', () => {
    expect(isSafeUrl('https://arxiv.org/pdf/2106.15928.pdf').ok).toBe(true)
    expect(isSafeUrl('https://www.nature.com/articles/s41586-021-03819-2.pdf').ok).toBe(true)
  })
})

describe('looksLikePdf', () => {
  it('detects the %PDF magic bytes', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e])
    expect(looksLikePdf(pdf)).toBe(true)
    expect(looksLikePdf(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBe(false) // <html
    expect(looksLikePdf(new Uint8Array([0x25, 0x50, 0x44]))).toBe(false) // too short
  })
})

describe('readBodyCapped', () => {
  it('returns null when the body exceeds the cap', async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5])
    const r = new Response(body)
    expect(await readBodyCapped(r, 4)).toBeNull()
  })

  it('returns the body under the cap', async () => {
    const body = new Uint8Array([1, 2, 3, 4, 5])
    const r = new Response(body)
    const out = await readBodyCapped(r, 10)
    expect(out).not.toBeNull()
    expect(Array.from(out!)).toEqual([1, 2, 3, 4, 5])
  })
})