import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScholarCardController, type ScholarCredentialsApi, type ScholarFieldSpec, type ScholarScopeLike } from '../src/client/controller.js'

const SPECS: ScholarFieldSpec[] = [
  { key: 's2ApiKey', kind: 'secret' },
  { key: 's2ApiKeyRef', kind: 'text' },
]

function makeScope(overrides: { value?: Record<string, unknown>; base?: Record<string, unknown>; user?: Record<string, unknown> } = {}): ScholarScopeLike {
  const value = overrides.value ?? {}
  const base = overrides.base ?? {}
  const user = overrides.user ?? {}
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready', writable: true, value, base, user }),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
  } as unknown as ScholarScopeLike
}

function makeCredentials(describeResult?: (req: { refs: readonly string[] }) => Promise<{ result: { ok: boolean; value: { credentials: Record<string, { configured?: boolean; writable?: boolean }> } } }>): ScholarCredentialsApi {
  const describe = describeResult ?? (async () => ({ result: { ok: true, value: { credentials: {} } } }))
  return {
    describe: vi.fn(describe),
    set: vi.fn(async () => ({})),
  }
}

afterEach(() => { vi.clearAllMocks() })

describe('ScholarCardController credentials-domain keys', () => {
  it('writes a staged key to the credentials domain, not the settings section', async () => {
    const scope = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials()
    const c = new ScholarCardController(scope, SPECS, (k) => k, { credentials })
    c.edit('s2ApiKey', 'secret-value')
    await c.save()
    expect(credentials.set).toHaveBeenCalledWith({ ref: 'S2_API_KEY', value: 'secret-value' })
    expect(scope.set).not.toHaveBeenCalled()
  })

  it('reads configured/writable from the credentials domain', async () => {
    const scope = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials(async () => ({ result: { ok: true, value: { credentials: { S2_API_KEY: { configured: true, writable: true } } } } }))
    const c = new ScholarCardController(scope, SPECS, (k) => k, { credentials })
    await vi.waitFor(() => {
      const field = c.inject().hooks.scholarCard.getSnapshot().fields['s2ApiKey']
      expect(field?.configured).toBe(true)
      expect(field?.writable).toBe(true)
    })
    expect(credentials.describe).toHaveBeenCalledWith({ refs: ['S2_API_KEY'] })
  })

  it('keeps the key write-only (blank draft, never an override)', async () => {
    const scope = makeScope({ value: { s2ApiKeyRef: 'MY_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' }, user: { s2ApiKeyRef: 'MY_KEY' } })
    const c = new ScholarCardController(scope, SPECS, (k) => k, { credentials: makeCredentials() })
    const field = c.inject().hooks.scholarCard.getSnapshot().fields['s2ApiKey']
    expect(field?.raw).toBe('')
    expect(field?.overridden).toBe(false)
    expect(field?.resolvedRaw).toBe('')
  })

  it('falls back to the default reference when the section names none', async () => {
    const scope = makeScope({ value: { s2ApiKeyRef: '' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials()
    const c = new ScholarCardController(scope, SPECS, (k) => k, { credentials })
    c.edit('s2ApiKey', 'value')
    await c.save()
    expect(credentials.set).toHaveBeenCalledWith({ ref: 'S2_API_KEY', value: 'value' })
  })
})
