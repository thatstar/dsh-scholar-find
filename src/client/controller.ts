/**
 * The dsh-scholar-find card controller (client half): a small zustand-free
 * snapshot store plus the form logic driven by a bound settings scope.
 * Mirrors the pattern of the shipped plugin cards without importing their
 * internal utilities (client bundle purity). The scope is consumed
 * structurally so the bundle never value-imports a DSH client package.
 * @module dsh-scholar-find/client-controller
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { DEFAULT_ASTA_KEY_REF, DEFAULT_SCIVERSE_KEY_REF, DEFAULT_S2_KEY_REF } from '../refs.js'

/** One editable field of the card. */
export type ScholarFieldKind = 'text' | 'secret' | 'number' | 'boolean'

export interface ScholarFieldSpec {
  key: string
  kind: ScholarFieldKind
}

/** One field's staged state as the card renders it. */
export interface ScholarFieldState {
  key: string
  kind: ScholarFieldKind
  label: string
  hint: string
  /** Staged raw text ('' = not edited / inherit). Booleans stage 'true'/'false'. */
  raw: string
  /** The current resolved value as text. */
  resolvedRaw: string
  /** Whether the user layer overrides this field. */
  overridden: boolean
  /** Localized invalid message; undefined when the staged value parses. */
  invalid?: string
  /** Write-only secret controls only: whether the credential is configured. */
  configured?: boolean
  /** Write-only secret controls only: whether the credentials domain accepts a write. */
  writable?: boolean
}

/** Card snapshot handed to the component. */
export interface ScholarCardSnapshot {
  status: 'loading' | 'ready' | 'unavailable'
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  fields: Record<string, ScholarFieldState>
}

/** The face the slot registration injects (hooks compartment -> useScholarCard). */
export interface ScholarCardFace {
  save(): Promise<void>
  discard(): void
  edit(field: string, raw: string): void
  toggle(field: string, checked: boolean): void
  resetField(field: string): void
  hooks: { scholarCard: SnapshotStore<ScholarCardSnapshot> }
}

/** Structural view of the settings scope the card controller consumes. */
export interface ScholarScopeLike {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable' | string
    writable: boolean
    value?: unknown
    base?: unknown
    user?: Record<string, unknown>
  }
  subscribe(fn: () => void): () => void
  set(field: string, value: unknown): Promise<void>
  unset(field: string): Promise<void>
}

/** Minimal structural view of the wire credentials domain (native key management). */
export interface ScholarCredentialsApi {
  describe(req: { refs: readonly string[] }): Promise<{ result: { ok: boolean; value: { credentials: Record<string, { configured?: boolean; writable?: boolean }> } } }>
  set(req: { ref: string; value: string }): Promise<unknown>
}

/**
 * Each write-only key control (a `secret`-kind field) addresses a credential
 * reference: the field named by `refField` in the section (a `credential-ref`
 * record name), or `defaultRef` when the section names none. The key literal is
 * written to the credentials domain, never stored in the settings section.
 */
const SECRET_REFS: Record<string, { refField: string; defaultRef: string }> = {
  s2ApiKey: { refField: 's2ApiKeyRef', defaultRef: DEFAULT_S2_KEY_REF },
  astaApiKey: { refField: 'astaApiKeyRef', defaultRef: DEFAULT_ASTA_KEY_REF },
  sciverseApiKey: { refField: 'sciverseApiKeyRef', defaultRef: DEFAULT_SCIVERSE_KEY_REF },
}

/** Minimal observable snapshot store (no external store dependency). */
class SnapshotStoreImpl<T> implements SnapshotStore<T> {
  private state: T
  private readonly listeners = new Set<() => void>()

  constructor(initial: T) {
    this.state = initial
  }

  getSnapshot(): T {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(next: T): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  update(mutator: (draft: T) => void): void {
    const draft = structuredClone(this.state)
    mutator(draft)
    this.set(draft)
  }
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export class ScholarCardController {
  /** State machine for the write latch: a save cannot overlap itself. */
  private writing = Promise.resolve()

  /** Per write-only key control: what the credentials domain reports. */
  private credentialState: Record<string, { configured: boolean; writable: boolean }> = {}

  private readonly store = new SnapshotStoreImpl<ScholarCardSnapshot>({
    status: 'loading',
    writable: false,
    dirty: false,
    invalid: false,
    saving: false,
    fields: {},
  })

  constructor(
    private readonly scope: ScholarScopeLike,
    private readonly specs: readonly ScholarFieldSpec[],
    private readonly t: (key: string) => string,
    private readonly api?: { credentials: ScholarCredentialsApi },
  ) {
    scope.subscribe(() => this.rebase())
    this.rebase()
  }

  /** The injected face: actions + the snapshot-store hooks compartment. */
  inject(): ScholarCardFace {
    return {
      save: () => this.save(),
      discard: () => this.discard(),
      edit: (field, raw) => this.edit(field, raw),
      toggle: (field, checked) => this.toggle(field, checked),
      resetField: (field) => this.resetField(field),
      hooks: { scholarCard: this.store },
    }
  }

  private snapshot(): ScholarCardSnapshot {
    return this.store.getSnapshot()
  }

  private view(): { value: Record<string, unknown>; base: Record<string, unknown>; user: Record<string, unknown>; writable: boolean } {
    const view = this.scope.getSnapshot()
    return {
      value: (view.value ?? {}) as Record<string, unknown>,
      base: (view.base ?? {}) as Record<string, unknown>,
      user: (view.user ?? {}) as Record<string, unknown>,
      writable: Boolean(view.writable),
    }
  }

  /** Whether a field is a write-only key control written to the credentials domain. */
  private isSecret(field: string): boolean {
    return Object.prototype.hasOwnProperty.call(SECRET_REFS, field)
  }

  /** The credential reference a key control addresses. */
  private refOf(field: string): string {
    const spec = SECRET_REFS[field]
    if (!spec) return ''
    const declared = this.view().value[spec.refField]
    return typeof declared === 'string' && declared.trim() ? declared.trim() : spec.defaultRef
  }

  private rebase(): void {
    const status = this.scope.getSnapshot().status
    if (status === 'loading') return
    if (status !== 'ready') {
      this.store.set({ status: 'unavailable', writable: false, dirty: false, invalid: false, saving: false, fields: {} })
      return
    }
    const { value, base, user, writable } = this.view()
    const resolvedOf = (key: string): string => textOf(value[key] ?? base[key])

    this.store.update((draft) => {
      draft.status = 'ready'
      draft.writable = writable
      for (const spec of this.specs) {
        const current = draft.fields[spec.key]
        if (this.isSecret(spec.key)) {
          // Write-only: the literal never seeds a draft; the card shows only
          // whether the credential is configured and writable.
          const cred = this.credentialState[spec.key]
          draft.fields[spec.key] = {
            key: spec.key,
            kind: spec.kind,
            label: this.t(spec.key),
            hint: this.t(`${spec.key}Hint`),
            raw: current?.raw ?? '',
            resolvedRaw: '',
            overridden: false,
            invalid: undefined,
            configured: cred?.configured ?? false,
            writable: cred?.writable ?? true,
          }
          void this.readCredential(spec.key)
          continue
        }
        draft.fields[spec.key] = {
          key: spec.key,
          kind: spec.kind,
          label: this.t(spec.key),
          hint: this.t(`${spec.key}Hint`),
          raw: current?.raw ?? resolvedOf(spec.key),
          resolvedRaw: resolvedOf(spec.key),
          overridden: Object.hasOwn(user, spec.key),
          invalid: current?.invalid,
        }
      }
      this.refreshValidity(draft)
    })
  }

  private refreshValidity(draft: ScholarCardSnapshot): void {
    let anyInvalid = false
    for (const spec of this.specs) {
      const field = draft.fields[spec.key]
      if (!field) continue
      if (this.isSecret(spec.key)) continue
      if (spec.kind === 'number' && field.raw !== '') {
        field.invalid = Number.isFinite(Number(field.raw)) ? undefined : this.t('invalidNumber')
      }
      if (field.invalid !== undefined) anyInvalid = true
    }
    const { value, base } = this.view()
    draft.dirty = this.specs.some((spec) => {
      const field = draft.fields[spec.key]
      if (!field) return false
      if (this.isSecret(spec.key)) return field.raw !== ''
      return Boolean(field.raw !== textOf(value[spec.key] ?? base[spec.key]))
    })
    draft.invalid = anyInvalid
  }

  /** Ask the credentials domain about a key control's reference and re-publish. */
  private async readCredential(field: string): Promise<void> {
    const ref = this.refOf(field)
    const api = this.api?.credentials
    if (!api || !ref) return
    try {
      const response = await api.describe({ refs: [ref] })
      if (!response.result.ok || ref !== this.refOf(field)) return
      const view = response.result.value.credentials[ref]
      const next = { configured: view?.configured ?? false, writable: view?.writable ?? true }
      const prev = this.credentialState[field]
      if (prev && prev.configured === next.configured && prev.writable === next.writable) return
      this.credentialState[field] = next
      const spec = this.specs.find((s) => s.key === field)
      if (spec) this.store.update((draft) => {
        const f = draft.fields[field]
        if (f) { f.configured = next.configured; f.writable = next.writable }
      })
    } catch {
      // A read failure leaves the control usable with its last-known state.
    }
  }

  edit(field: string, raw: string): void {
    this.store.update((draft) => {
      if (draft.fields[field]) draft.fields[field].raw = raw
      this.refreshValidity(draft)
    })
  }

  toggle(field: string, checked: boolean): void {
    this.edit(field, checked ? 'true' : 'false')
  }

  discard(): void {
    this.rebase()
  }

  resetField(field: string): void {
    // A write-only key control has no settings field to unset; reset clears the
    // typed draft (a blank draft writes nothing).
    if (this.isSecret(field)) {
      this.edit(field, '')
      return
    }
    void this.scope.unset(field)
  }

  save(): Promise<void> {
    const snapshot = this.snapshot()
    if (!snapshot.dirty || snapshot.invalid || snapshot.saving) return Promise.resolve()
    this.store.update((draft) => { draft.saving = true })
    this.writing = this.writing.then(async () => {
      try {
        const { value, base } = this.view()
        const apiWrites: Promise<unknown>[] = []
        const writes: Promise<void>[] = []
        const secretFields: string[] = []
        for (const spec of this.specs) {
          const field = this.store.getSnapshot().fields[spec.key]
          if (!field) continue
          if (this.isSecret(spec.key)) {
            if (field.raw !== '') {
              secretFields.push(spec.key)
              const ref = this.refOf(spec.key)
              const api = this.api?.credentials
              if (api && ref) {
                apiWrites.push(api.set({ ref, value: field.raw }).catch(() => undefined))
              }
            }
            continue
          }
          if (field.raw === textOf(value[spec.key] ?? base[spec.key])) continue
          if (field.raw === '') {
            writes.push(this.scope.unset(spec.key))
            continue
          }
          const parsed = spec.kind === 'number' ? Number(field.raw) : spec.kind === 'boolean' ? field.raw === 'true' : field.raw
          writes.push(this.scope.set(spec.key, parsed))
        }
        await Promise.all([...writes, ...apiWrites])
        this.store.update((draft) => {
          for (const field of secretFields) {
            const f = draft.fields[field]
            if (f) f.raw = ''
          }
        })
        for (const field of secretFields) await this.readCredential(field)
      } catch (e) {
        // A failed save must not strand the card: keep the user's input (so they
        // can fix and retry) and release the write latch. `console.warn` keeps
        // the error audible without rejecting the chain (which would brand
        // `this.writing` rejected and break every later save).
        console.warn(`[dsh-scholar-find] save failed: ${(e as Error).message}`)
      } finally {
        this.store.update((draft) => { draft.saving = false })
      }
    })
    return this.writing
  }
}