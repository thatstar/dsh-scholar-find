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
    // Mirror the harness scope: a successful set folds into the snapshot and
    // notifies subscribers (which rebases the card and recomputes dirty).
    set: vi.fn(async (field: string, v: unknown) => {
      ;(value as Record<string, unknown>)[field] = v
      for (const listener of listeners) listener()
    }),
    unset: vi.fn(async () => {}),
  } as unknown as ScholarScopeLike
}

function makeCredentials(describeResult?: (refs: readonly string[]) => Promise<{ ok: boolean; value: Record<string, { configured?: boolean; writable?: boolean }> }>): ScholarCredentialsApi {
  const describe = describeResult ?? (async () => ({ ok: true, value: {} }))
  return {
    describe: vi.fn(describe),
    set: vi.fn(async () => undefined),
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
    expect(credentials.set).toHaveBeenCalledWith('S2_API_KEY', 'secret-value')
    expect(scope.set).not.toHaveBeenCalled()
  })

  it('reads configured/writable from the credentials domain', async () => {
    const scope = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials(async () => ({ ok: true, value: { S2_API_KEY: { configured: true, writable: true } } }))
    const c = new ScholarCardController(scope, SPECS, (k) => k, { credentials })
    await vi.waitFor(() => {
      const field = c.inject().hooks.scholarCard.getSnapshot().fields['s2ApiKey']
      expect(field?.configured).toBe(true)
      expect(field?.writable).toBe(true)
    })
    expect(credentials.describe).toHaveBeenCalledWith(['S2_API_KEY'])
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
    expect(credentials.set).toHaveBeenCalledWith('S2_API_KEY', 'value')
  })

  it('clears the unsaved badge after a key save (secrets never touch the scope)', async () => {
    const scope = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials()
    const c = new ScholarCardController(scope, SPECS, (k) => k, { credentials })
    c.edit('s2ApiKey', 'secret-value')
    expect(c.inject().hooks.scholarCard.getSnapshot().dirty).toBe(true)
    await c.save()
    const snap = c.inject().hooks.scholarCard.getSnapshot()
    expect(snap.dirty).toBe(false)
    expect(snap.fields['s2ApiKey']?.raw).toBe('')
    expect(scope.set).not.toHaveBeenCalled()
  })

  it('clears the unsaved badge after a text-field save', async () => {
    const scope = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const c = new ScholarCardController(scope, [...SPECS, { key: 'proxyUrl', kind: 'text' }], (k) => k, { credentials: makeCredentials() })
    c.edit('proxyUrl', 'http://127.0.0.1:10808')
    expect(c.inject().hooks.scholarCard.getSnapshot().dirty).toBe(true)
    await c.save()
    expect(c.inject().hooks.scholarCard.getSnapshot().dirty).toBe(false)
  })
})
