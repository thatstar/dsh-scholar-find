/**
 * Client-half tests for the settings page controller: the shared form model
 * over a fake settings scope, and the credentials-domain seam behind the three
 * write-only key controls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsFormPathOp, SettingsFormScope } from '@deepseek-ai/dsh-client-ui-primitives'
import { ScholarCardController, type ScholarCredentialsApi, type ScholarSettingsRecord } from '../src/client/controller.js'

interface ScopeHarness {
  scope: SettingsFormScope<ScholarSettingsRecord>
  mutate: ReturnType<typeof vi.fn>
}

/**
 * A settings scope shaped like the shared configuration form: a section that
 * folds accepted mutations into its snapshot and notifies subscribers.
 */
function makeScope(overrides: { value?: ScholarSettingsRecord; base?: ScholarSettingsRecord; user?: ScholarSettingsRecord } = {}): ScopeHarness {
  const value = (overrides.value ?? {}) as Record<string, unknown>
  const base = overrides.base ?? {}
  const user = (overrides.user ?? {}) as Record<string, unknown>
  const listeners = new Set<() => void>()
  const mutate = vi.fn(async (ops: readonly SettingsFormPathOp[]) => {
    for (const op of ops) {
      const key = op.path[0] ?? ''
      if (op.op === 'set') { value[key] = op.value; user[key] = op.value }
      else { delete value[key]; delete user[key] }
    }
    for (const listener of listeners) listener()
    return true
  })
  return {
    mutate,
    scope: {
      getSnapshot: () => ({ status: 'ready' as const, value, base, user, writable: true, revision: 1 }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      mutate,
    } as unknown as SettingsFormScope<ScholarSettingsRecord>,
  }
}

/** The credentials domain as the page sees it: `describe(refs)` / `set(ref, value)`. */
function makeCredentials(
  describeResult?: (refs: readonly string[]) => Promise<{ ok: boolean; value: Record<string, { configured?: boolean; writable?: boolean }> }>,
): ScholarCredentialsApi {
  const describe = describeResult ?? (async () => ({ ok: true, value: {} }))
  return { describe: vi.fn(describe), set: vi.fn(async () => undefined) }
}

/** The live snapshot the page's component reads. */
function snapshot(c: ScholarCardController) {
  return c.inject().hooks.scholarCard.getSnapshot()
}

afterEach(() => { vi.clearAllMocks() })

describe('ScholarCardController', () => {
  it('writes a staged key to the credentials domain, not the settings row', async () => {
    const { scope, mutate } = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials()
    const c = new ScholarCardController(scope, credentials)
    c.inject().edit('s2ApiKey', 'secret-value')
    expect(snapshot(c).dirty).toBe(true)
    await c.save()
    expect(credentials.set).toHaveBeenCalledWith('S2_API_KEY', 'secret-value')
    expect(mutate).not.toHaveBeenCalled()
    expect(snapshot(c).dirty).toBe(false)
  })

  it('reads configured/writable from the credentials domain', async () => {
    const { scope } = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials(async () => ({ ok: true, value: { S2_API_KEY: { configured: true, writable: true } } }))
    const c = new ScholarCardController(scope, credentials)
    await vi.waitFor(() => {
      expect(snapshot(c).credentials.s2ApiKey.configured).toBe(true)
    })
    expect(credentials.describe).toHaveBeenCalledWith(['S2_API_KEY'])
  })

  it('keeps the key write-only (blank draft, never an override, nothing staged on save)', async () => {
    const { scope, mutate } = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials()
    const c = new ScholarCardController(scope, credentials)
    const field = snapshot(c).fields.s2ApiKey
    expect(field.text).toBe('')
    expect(field.overridden).toBe(false)
    await c.save()
    expect(credentials.set).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('falls back to the default reference when the section names none', async () => {
    const { scope } = makeScope({ value: { s2ApiKeyRef: '' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const credentials = makeCredentials()
    const c = new ScholarCardController(scope, credentials)
    c.inject().edit('s2ApiKey', 'value')
    await c.save()
    expect(credentials.set).toHaveBeenCalledWith('S2_API_KEY', 'value')
  })

  it('saves a section field as one revision-fenced mutation', async () => {
    const { scope, mutate } = makeScope({ value: { maxResultsPerSearch: 20 }, base: { maxResultsPerSearch: 20 } })
    const c = new ScholarCardController(scope, makeCredentials())
    c.inject().edit('maxResultsPerSearch', '30')
    expect(snapshot(c).dirty).toBe(true)
    await c.save()
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]?.[0]).toEqual([{ op: 'set', path: ['maxResultsPerSearch'], value: 30 }])
    expect(mutate.mock.calls[0]?.[1]).toBe(1)
    expect(snapshot(c).dirty).toBe(false)
  })

  it('clears a section field back to the schema default (unset, not an empty write)', async () => {
    const { scope, mutate } = makeScope({ value: { proxyUrl: 'http://127.0.0.1:10808' }, base: { proxyUrl: '' }, user: { proxyUrl: 'http://127.0.0.1:10808' } })
    const c = new ScholarCardController(scope, makeCredentials())
    expect(snapshot(c).fields.proxyUrl.overridden).toBe(true)
    c.inject().resetField('proxyUrl')
    await c.save()
    expect(mutate.mock.calls[0]?.[0]).toEqual([{ op: 'unset', path: ['proxyUrl'] }])
  })

  it('refuses an unparsable number instead of writing it', async () => {
    const { scope, mutate } = makeScope({ value: { fetchTimeoutSec: 30 }, base: { fetchTimeoutSec: 30 } })
    const c = new ScholarCardController(scope, makeCredentials())
    c.inject().edit('fetchTimeoutSec', 'soon')
    expect(snapshot(c).invalid).toBe(true)
    await c.save()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('stages the boolean toggle as true/false text', async () => {
    const { scope, mutate } = makeScope({ value: { cloakEnabled: false }, base: { cloakEnabled: false } })
    const c = new ScholarCardController(scope, makeCredentials())
    c.inject().edit('cloakEnabled', 'true')
    await c.save()
    expect(mutate.mock.calls[0]?.[0]).toEqual([{ op: 'set', path: ['cloakEnabled'], value: true }])
  })

  it('re-reads a key badge when the Host reports its reference changed', async () => {
    const { scope } = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    let configured = false
    const credentials = makeCredentials(async () => ({ ok: true, value: { S2_API_KEY: { configured, writable: true } } }))
    const c = new ScholarCardController(scope, credentials)
    await vi.waitFor(() => { expect(credentials.describe).toHaveBeenCalled() })
    expect(snapshot(c).credentials.s2ApiKey.configured).toBe(false)
    configured = true
    c.refreshCredential('S2_API_KEY')
    await vi.waitFor(() => { expect(snapshot(c).credentials.s2ApiKey.configured).toBe(true) })
    // A reference the page does not watch costs no extra round trip.
    const calls = (credentials.describe as ReturnType<typeof vi.fn>).mock.calls.length
    c.refreshCredential('SOME_OTHER_KEY')
    expect((credentials.describe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
  })

  it('degrades to an unusable key control when the deployment serves no credentials domain', async () => {
    const { scope } = makeScope({ value: { s2ApiKeyRef: 'S2_API_KEY' }, base: { s2ApiKeyRef: 'S2_API_KEY' } })
    const c = new ScholarCardController(scope, undefined)
    expect(snapshot(c).fields.s2ApiKey.text).toBe('')
    c.inject().edit('s2ApiKey', 'not-writable-anywhere')
    await c.save()
    expect(snapshot(c).failed).toBe(true)
  })
})
