import { afterEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_UA, configureProxy, normalizeProxyUrl, pluginFetch, resolveProxyUrl } from '../src/fetch/transport.js'

const fetchMock = vi.fn()
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  configureProxy(undefined) // ensure no proxy leaks between tests
})

function stubFetch(response: Response): void {
  fetchMock.mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
}

describe('resolveProxyUrl', () => {
  it('prefers the plugin setting over env vars', () => {
    process.env.HTTPS_PROXY = 'http://env:3128'
    expect(resolveProxyUrl('http://127.0.0.1:10808')).toBe('http://127.0.0.1:10808')
    delete process.env.HTTPS_PROXY
  })

  it('falls back to HTTPS_PROXY / HTTP_PROXY / ALL_PROXY when the setting is empty', () => {
    process.env.HTTPS_PROXY = 'http://env:3128'
    expect(resolveProxyUrl('')).toBe('http://env:3128')
    delete process.env.HTTPS_PROXY
    process.env.ALL_PROXY = 'socks5://localhost:1080'
    expect(resolveProxyUrl(undefined)).toBe('socks5://localhost:1080')
    delete process.env.ALL_PROXY
  })

  it('returns undefined when nothing is configured', () => {
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
    delete process.env.ALL_PROXY
    expect(resolveProxyUrl(undefined)).toBeUndefined()
  })
})

describe('normalizeProxyUrl', () => {
  it('adds http:// to a bare host:port', () => {
    expect(normalizeProxyUrl('127.0.0.1:10808')).toBe('http://127.0.0.1:10808')
    expect(normalizeProxyUrl('http://already')).toBe('http://already')
  })
})

describe('pluginFetch', () => {
  it('sends the browser User-Agent when the caller did not set one', async () => {
    stubFetch(new Response('ok'))
    await pluginFetch('https://example.com', { headers: { Accept: 'application/json' } })
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(BROWSER_UA)
  })

  it('does not override a caller-supplied User-Agent', async () => {
    stubFetch(new Response('ok'))
    await pluginFetch('https://example.com', { headers: { 'User-Agent': 'custom/1.0' } })
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('custom/1.0')
  })
})