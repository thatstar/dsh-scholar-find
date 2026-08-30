import { afterEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_UA, configureProxy, normalizeProxyUrl, pluginFetch, resolveProxyUrl, timedFetch } from '../src/fetch/transport.js'

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
    delete process.env.HTTP_PROXY
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

/** A fetch stub that never settles on its own but rejects when its signal aborts
 * (mirroring undici, which aborts in-flight requests on signal fire). */
function abortAwaitingFetch(): void {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const s = init?.signal
    if (!s) return
    if (s.aborted) {
      reject(s.reason ?? new Error('aborted'))
      return
    }
    s.addEventListener('abort', () => reject(s.reason ?? new Error('aborted')), { once: true })
  }))
  vi.stubGlobal('fetch', fetchMock)
}

describe('timedFetch', () => {
  it('returns the response when the fetch resolves in time', async () => {
    stubFetch(new Response('ok'))
    const r = await timedFetch('https://example.com', {}, { timeoutMs: 1000 })
    expect(await r.text()).toBe('ok')
  })

  it('rejects with the default timeout error when the underlying fetch stalls', async () => {
    abortAwaitingFetch()
    await expect(timedFetch('https://example.com', {}, { timeoutMs: 50 })).rejects.toThrow('timeout after 50ms')
  })

  it('surfaces the errorLabel on timeout', async () => {
    abortAwaitingFetch()
    await expect(timedFetch('https://example.com', {}, { timeoutMs: 50, errorLabel: 'landing timeout' })).rejects.toThrow('landing timeout')
  })

  it('forwards an outer-signal abort with its reason', async () => {
    abortAwaitingFetch()
    const ac = new AbortController()
    const p = timedFetch('https://example.com', {}, { timeoutMs: 10_000, signal: ac.signal })
    await Promise.resolve() // let the fetch attach its listener
    ac.abort(new Error('user cancel'))
    await expect(p).rejects.toThrow('user cancel')
  })

  it('rejects immediately when the signal is already aborted', async () => {
    abortAwaitingFetch()
    const ac = new AbortController()
    ac.abort(new Error('cancelled before'))
    await expect(timedFetch('https://example.com', {}, { timeoutMs: 10_000, signal: ac.signal })).rejects.toThrow('cancelled before')
  })
})