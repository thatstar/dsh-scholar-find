/**
 * The dsh-scholar-find settings page controller (client half): a staged form
 * over this plugin's Config entry, plus the badge the credentials domain
 * answers for the three write-only key controls.
 *
 * The page renders through the harness's shared settings atoms
 * (`SettingsForm`, `SettingsValueField`, `SettingsSecretField`) and therefore
 * produces exactly the state those atoms read — `SettingsFormShell` and
 * `SettingsFieldState`, imported here as TYPES. The state machine that builds
 * them lives in this file rather than being imported from
 * `@deepseek-ai/dsh-client-ui-primitives` for two reasons: the published
 * primitives entry eagerly imports its whole markdown/highlighter stack (so a
 * Node-side test could not load the package at all), and the rest of this
 * plugin's client half already consumes harness seams structurally rather than
 * value-importing a client package.
 *
 * Semantics, in the shared contract's terms: drafts are staged and written by
 * ONE revision-fenced mutation on save; `overridden` previews whether saving
 * would leave a user-layer entry; an unparsable draft blocks the save and is
 * kept for correction; a save the Host refuses leaves the drafts in place and
 * reports `failed`. The three API keys are the exception the model exists for:
 * their literals never ride a settings response, so the page learns only
 * whether the credentials domain holds one and writes the typed value there.
 * @module dsh-scholar-find/client-controller
 */

import type {
  SettingsFieldState,
  SettingsFormPathOp,
  SettingsFormScope,
  SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_ASTA_KEY_REF, DEFAULT_SCIVERSE_KEY_REF, DEFAULT_S2_KEY_REF } from '../refs.js'

/**
 * The plugin Config as this page reads and writes it. Every field is optional
 * because the Host may resolve only part of the section; the schema defaults
 * arrive as ordinary values in the scope's `value`.
 */
export interface ScholarSettingsRecord {
  unpaywallEmail?: string
  s2ApiKeyRef?: string
  astaApiKeyRef?: string
  sciverseApiKeyRef?: string
  cloakEnabled?: boolean
  proxyUrl?: string
  defaultOutputDir?: string
  maxResultsPerSearch?: number
  fetchTimeoutSec?: number
  maxPdfSizeMb?: number
  s2RequestGapMs?: number
}

/** Config fields the page renders a value control for (the credential references stay schema-defaulted and unexposed). */
export type ScholarFieldKey =
  | 'unpaywallEmail' | 'cloakEnabled' | 'proxyUrl' | 'defaultOutputDir'
  | 'maxResultsPerSearch' | 'fetchTimeoutSec' | 'maxPdfSizeMb' | 's2RequestGapMs'

/** Write-only controls, each addressing a DSH credential record (never the settings row). */
export type ScholarSecretKey = 's2ApiKey' | 'astaApiKey' | 'sciverseApiKey'

/** Value fields the page renders, in render order. */
export const SCHOLAR_FIELD_ORDER: readonly ScholarFieldKey[] = [
  'unpaywallEmail', 'cloakEnabled', 'proxyUrl', 'defaultOutputDir',
  'maxResultsPerSearch', 'fetchTimeoutSec', 'maxPdfSizeMb', 's2RequestGapMs',
]

/** Page snapshot handed to the component. */
export interface ScholarCardSnapshot extends SettingsFormShell {
  /** Staged/dirty state per control, section fields and write-only keys alike. */
  fields: Record<ScholarFieldKey | ScholarSecretKey, SettingsFieldState>
  /** Key controls only: what the credentials domain reports for their reference. */
  credentials: Record<ScholarSecretKey, { configured: boolean; writable: boolean }>
}

/** The face the page's slot registration injects (hooks compartment → `useScholarCard`). */
export interface ScholarCardFace {
  save(): void
  discard(): void
  edit(field: string, text: string): void
  resetField(field: string): void
  hooks: { scholarCard: ObservableSnapshot<ScholarCardSnapshot> }
}

/** Minimal structural view of the credentials domain on the wire (native key management). */
export interface ScholarCredentialsApi {
  /** `describe(refs)` → `{ok, value: {[ref]: {configured?, writable?}}}` — value keyed by ref. */
  describe(refs: readonly string[]): Promise<{ ok: boolean; value: Record<string, { configured?: boolean; writable?: boolean }> }>
  /** `set(ref, value)` — positional, per the current `remote.credentials` contract. */
  set(ref: string, value: string): Promise<unknown>
}

/** The write one field's staged text performs when the page is saved. */
type FieldWrite = { kind: 'set'; value: unknown } | { kind: 'clear' }

/** How one section field converts between its stored value and its draft text. */
interface FieldSpec {
  field: ScholarFieldKey
  /** Render a stored value as draft text; the empty string when the section carries none. */
  format(value: unknown): string
  /** The write this draft text stages, or undefined when the field cannot accept it. */
  parse(text: string): FieldWrite | undefined
}

/** One staged draft: its text, and whether it is a reset to the composition layer. */
interface StagedEdit {
  text: string
  clear: boolean
}

/** One planned write: a section path operation, a write-only action, or neither (an invalid draft). */
interface PlannedWrite {
  field: string
  op?: SettingsFormPathOp
  run?: () => Promise<boolean>
}

/** A free-text field: an empty draft clears it back to the schema default. */
const textField = (field: ScholarFieldKey): FieldSpec => ({
  field,
  format: (value) => (typeof value === 'string' ? value : ''),
  parse: (text) => {
    const trimmed = text.trim()
    return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
  },
})

/** A numeric field: any finite number is accepted, anything else blocks the save. */
const numberField = (field: ScholarFieldKey): FieldSpec => ({
  field,
  format: (value) => (typeof value === 'number' ? String(value) : ''),
  parse: (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'clear' }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
  },
})

/**
 * A boolean field, staged as `'true'` / `'false'` text so it rides the same
 * state machine as every other field. Only those two drafts are accepted; a
 * checkbox can produce nothing else, and guessing at anything else would hide a
 * bug rather than block the save.
 */
const booleanField = (field: ScholarFieldKey): FieldSpec => ({
  field,
  format: (value) => (typeof value === 'boolean' ? String(value) : ''),
  parse: (text) => {
    const trimmed = text.trim()
    if (trimmed === '') return { kind: 'clear' }
    if (trimmed !== 'true' && trimmed !== 'false') return undefined
    return { kind: 'set', value: trimmed === 'true' }
  },
})

/** Section fields this page edits. */
const FIELD_SPECS: readonly FieldSpec[] = [
  textField('unpaywallEmail'),
  booleanField('cloakEnabled'),
  textField('proxyUrl'),
  textField('defaultOutputDir'),
  numberField('maxResultsPerSearch'),
  numberField('fetchTimeoutSec'),
  numberField('maxPdfSizeMb'),
  numberField('s2RequestGapMs'),
]

/**
 * Each write-only key control addresses a credential record: the field named by
 * `refField` in the section (a `credential-ref` record name), or `defaultRef`
 * when the section names none. The key literal is written to the credentials
 * domain, never stored in the settings row.
 */
const SECRET_FIELDS: ReadonlyArray<{ field: ScholarSecretKey; refField: keyof ScholarSettingsRecord; defaultRef: string }> = [
  { field: 's2ApiKey', refField: 's2ApiKeyRef', defaultRef: DEFAULT_S2_KEY_REF },
  { field: 'astaApiKey', refField: 'astaApiKeyRef', defaultRef: DEFAULT_ASTA_KEY_REF },
  { field: 'sciverseApiKey', refField: 'sciverseApiKeyRef', defaultRef: DEFAULT_SCIVERSE_KEY_REF },
]

/** The secret spec for one key control (its reference is resolved at write time, from the live section). */
const secretFieldOf = (field: ScholarSecretKey): (typeof SECRET_FIELDS)[number] | undefined =>
  SECRET_FIELDS.find((spec) => spec.field === field)

/**
 * Minimal observable snapshot store: what the slot framework's selector hook
 * needs (a stable `getSnapshot` plus a `subscribe`), and nothing else — this
 * plugin never mutates a store through an immer draft.
 */
class SnapshotStoreImpl<T> implements ObservableSnapshot<T> {
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
}

/** The staged form for this plugin's settings entry, wired to the credentials domain. */
export class ScholarCardController {
  private readonly specs = new Map<string, FieldSpec>(FIELD_SPECS.map((spec) => [spec.field, spec]))
  private readonly staged = new Map<string, StagedEdit>()
  private readonly store: SnapshotStoreImpl<ScholarCardSnapshot>
  private readonly unsubscribe: () => void

  /** The scope snapshot the current drafts were staged against (empty until the first edit). */
  private baseline: { revision?: number } | undefined

  private saving = false
  private failed = false

  /** Per key control: what the credentials domain last reported. */
  private credentialState: Record<ScholarSecretKey, { configured: boolean; writable: boolean }> = {
    s2ApiKey: { configured: false, writable: true },
    astaApiKey: { configured: false, writable: true },
    sciverseApiKey: { configured: false, writable: true },
  }

  /**
   * @param scope - the shared configuration form for this plugin's entry.
   * @param credentials - the credentials domain, when the deployment provides it.
   */
  constructor(
    private readonly scope: SettingsFormScope<ScholarSettingsRecord>,
    private readonly credentials?: ScholarCredentialsApi,
  ) {
    this.store = new SnapshotStoreImpl(this.projection())
    this.unsubscribe = scope.subscribe(() => { this.publish() })
    void this.readCredentials()
  }

  /** The injected face: actions + the snapshot-store hooks compartment. */
  inject(): ScholarCardFace {
    return {
      edit: (field, text) => { this.stage(field, { text, clear: false }) },
      resetField: (field) => { this.reset(field) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
      hooks: { scholarCard: this.store },
    }
  }

  /** Release the scope subscription and every staged draft. */
  dispose(): void {
    this.unsubscribe()
    this.staged.clear()
  }

  /**
   * Write every staged edit as one revision-fenced mutation, then the
   * write-only key controls through the credentials domain.
   *
   * A save the Host refuses — stale revision, or a value its own validators
   * reject — keeps the drafts so the user can correct them.
   * @returns settlement after every write, for a caller that wants to await it.
   */
  async save(): Promise<void> {
    const plan = this.plan()
    if (plan.length === 0 || this.saving || !this.scope.getSnapshot().writable) return
    if (plan.some((item) => item.op === undefined && item.run === undefined)) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const ops = plan.flatMap((item) => (item.op ? [item.op] : []))
      let landed = ops.length === 0 || await this.scope.mutate(ops, this.baseline?.revision)
      if (!landed) {
        this.failed = true
        return
      }
      for (const item of plan) {
        if (!item.run) continue
        landed = (await item.run()) && landed
      }
      if (landed) {
        this.staged.clear()
        this.baseline = undefined
      }
      this.failed = !landed
    } catch {
      // A transport failure reads like a refused write to the user: keep what
      // they typed and let the frame report it.
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }

  /**
   * Re-read a key control's badge after the Host reports its reference changed
   * (a key can be written from elsewhere, e.g. the Models page).
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    for (const { field } of SECRET_FIELDS) {
      if (this.refOf(field) === ref) void this.readCredential(field)
    }
  }

  /** Drop every staged draft. */
  private discard(): void {
    if (this.staged.size === 0 && !this.failed) return
    this.staged.clear()
    this.baseline = undefined
    this.failed = false
    this.publish()
  }

  /** Stage one draft; the first edit pins the revision the save fences against. */
  private stage(field: string, edit: StagedEdit): void {
    this.baseline ??= this.scope.getSnapshot()
    this.staged.set(field, edit)
    this.failed = false
    this.publish()
  }

  /** Stage a clear (a section field) or drop the typed draft (a key control). */
  private reset(field: string): void {
    if (secretFieldOf(field as ScholarSecretKey)) {
      this.stage(field, { text: '', clear: false })
      return
    }
    const spec = this.specs.get(field)
    if (!spec) return
    this.stage(field, { text: spec.format(this.baseOf(field)), clear: true })
  }

  /** Every write a save would perform, in staging order. */
  private plan(): PlannedWrite[] {
    const plan: PlannedWrite[] = []
    for (const [field, staged] of this.staged) {
      const secret = secretFieldOf(field as ScholarSecretKey)
      if (secret) {
        // A blank key draft writes nothing: it keeps the stored key rather
        // than clearing it, which is the only safe reading of an empty box.
        const value = staged.text.trim()
        if (value !== '') plan.push({ field, run: () => this.writeKey(secret.field, value) })
        continue
      }
      const spec = this.specs.get(field)
      if (!spec) continue
      if (staged.clear) {
        if (this.stored(field)) plan.push({ field, op: { op: 'unset', path: [field] } })
        continue
      }
      if (staged.text === spec.format(this.valueOf(field))) continue
      const write = spec.parse(staged.text)
      if (write === undefined) plan.push({ field })
      else if (write.kind === 'clear') plan.push({ field, op: { op: 'unset', path: [field] } })
      else plan.push({ field, op: { op: 'set', path: [field], value: write.value } })
    }
    return plan
  }

  /** One control's state, as the shared field atoms render it. */
  private fieldState(field: string): SettingsFieldState {
    const staged = this.staged.get(field)
    if (secretFieldOf(field as ScholarSecretKey)) {
      return { text: staged?.text ?? '', overridden: false, invalid: false }
    }
    const spec = this.specs.get(field)
    if (!spec) return { text: '', overridden: false, invalid: false }
    if (!staged) return { text: spec.format(this.valueOf(field)), overridden: this.stored(field), invalid: false }
    const write: FieldWrite | undefined = staged.clear ? { kind: 'clear' } : spec.parse(staged.text)
    return { text: staged.text, overridden: write?.kind === 'set', invalid: write === undefined }
  }

  private projection(): ScholarCardSnapshot {
    const scope = this.scope.getSnapshot()
    const fields = {} as Record<ScholarFieldKey | ScholarSecretKey, SettingsFieldState>
    for (const field of SCHOLAR_FIELD_ORDER) fields[field] = this.fieldState(field)
    for (const { field } of SECRET_FIELDS) fields[field] = this.fieldState(field)
    const plan = this.plan()
    return {
      available: scope.status === 'ready',
      writable: scope.writable,
      dirty: plan.length > 0,
      invalid: plan.some((item) => item.op === undefined && item.run === undefined),
      saving: this.saving,
      failed: this.failed,
      fields,
      credentials: { ...this.credentialState },
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  /** The section's resolved value for one field. */
  private valueOf(field: string): unknown {
    return (this.scope.getSnapshot().value as Record<string, unknown> | undefined)?.[field]
  }

  /** The composition layer's value for one field: what a cleared field reverts to. */
  private baseOf(field: string): unknown {
    return (this.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
  }

  /** Whether the user layer carries this field (what marks it overridden). */
  private stored(field: string): boolean {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null && Object.hasOwn(user, field)
  }

  /** The credential reference a key control addresses, as the section declares it. */
  private refOf(field: ScholarSecretKey): string {
    const spec = secretFieldOf(field)
    if (!spec) return ''
    const declared = this.valueOf(spec.refField)
    return typeof declared === 'string' && declared.trim() ? declared.trim() : spec.defaultRef
  }

  /** Ask the credentials domain about every key control's reference. */
  private async readCredentials(): Promise<void> {
    await Promise.all(SECRET_FIELDS.map(async ({ field }) => this.readCredential(field)))
  }

  /**
   * Ask the credentials domain about one reference and re-publish.
   *
   * The answer is stored with the reference it describes: the declared
   * reference can change between the request and its response, and two reads
   * can settle out of order, so a response is published only while it still
   * answers for the reference in force.
   * @param field - the key control to refresh.
   */
  private async readCredential(field: ScholarSecretKey): Promise<void> {
    const api = this.credentials
    const ref = this.refOf(field)
    if (!api || !ref) return
    try {
      const response = await api.describe([ref])
      if (!response.ok || ref !== this.refOf(field)) return
      const view = response.value[ref]
      const next = { configured: view?.configured ?? false, writable: view?.writable ?? true }
      const previous = this.credentialState[field]
      if (previous.configured === next.configured && previous.writable === next.writable) return
      this.credentialState[field] = next
      this.publish()
    } catch {
      // A read failure leaves the control usable with its last-known state.
    }
  }

  /**
   * Write the staged key to the credentials domain, then refresh its badge.
   *
   * A settling `set()` IS the Host's acceptance (the Remote rejects on
   * failure), so the draft is cleared and only the badge is re-read.
   * @param field - the key control being saved.
   * @param value - the staged credential literal.
   * @returns whether the Host accepted the write.
   */
  private async writeKey(field: ScholarSecretKey, value: string): Promise<boolean> {
    const api = this.credentials
    const ref = this.refOf(field)
    if (!api || !ref) return false
    await api.set(ref, value)
    await this.readCredential(field)
    return true
  }
}
