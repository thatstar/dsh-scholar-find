/**
 * The dsh-scholar card controller (client half): a small zustand-free
 * snapshot store plus the form logic driven by a bound settings scope.
 * Mirrors the pattern of the shipped plugin cards without importing their
 * internal utilities (client bundle purity). The scope is consumed
 * structurally so the bundle never value-imports a DSH client package.
 * @module dsh-scholar/client-controller
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

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
      if (spec.kind === 'number' && field.raw !== '') {
        field.invalid = Number.isFinite(Number(field.raw)) ? undefined : this.t('invalidNumber')
      }
      if (field.invalid !== undefined) anyInvalid = true
    }
    const { value, base } = this.view()
    draft.dirty = this.specs.some((spec) => {
      const field = draft.fields[spec.key]
      return Boolean(field && field.raw !== textOf(value[spec.key] ?? base[spec.key]))
    })
    draft.invalid = anyInvalid
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
    void this.scope.unset(field)
  }

  save(): Promise<void> {
    const snapshot = this.snapshot()
    if (!snapshot.dirty || snapshot.invalid || snapshot.saving) return Promise.resolve()
    this.store.update((draft) => { draft.saving = true })
    this.writing = this.writing.then(async () => {
      const { value, base } = this.view()
      const writes: Promise<void>[] = []
      for (const spec of this.specs) {
        const field = this.store.getSnapshot().fields[spec.key]
        if (!field || field.raw === textOf(value[spec.key] ?? base[spec.key])) continue
        if (field.raw === '') {
          writes.push(this.scope.unset(spec.key))
          continue
        }
        const parsed = spec.kind === 'number' ? Number(field.raw) : spec.kind === 'boolean' ? field.raw === 'true' : field.raw
        writes.push(this.scope.set(spec.key, parsed))
      }
      await Promise.all(writes)
      this.store.update((draft) => { draft.saving = false })
    })
    return this.writing
  }
}