/**
 * The dsh-scholar-find settings card (client half). Rendered inside the Plugins
 * configuration tab for the `dsh-scholar-find` namespace via the
 * `settings.plugin.item` keyed slot. The markup and design tokens mirror the
 * shipped `PluginCard`/`ValueField` cards so it reads as part of the same
 * surface (the shipped components are not publicly exportable, so the card
 * draws its own DOM using the same `--dsw-alias-*` theme variables).
 * @module dsh-scholar-find/client-card
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScholarCardFace, ScholarFieldState } from './controller.js'
import type { ScholarLocaleKey } from './locales.js'

export type ScholarCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'dsh-scholar-find'>
  & InjectFace<ScholarCardFace>

/** Design tokens reused from the settings surface (theme-controlled). */
const tokens = {
  card: 'var(--dsw-alias-border-l2)',
  cardOpenBorder: 'var(--dsw-alias-label-dimmed)',
  layer3: 'var(--dsw-alias-bg-layer-3)',
  layer2: 'var(--dsw-alias-bg-layer-2)',
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  labelError: 'var(--dsw-alias-label-error)',
  brand: 'var(--dsw-alias-brand-primary)',
  moduleBg: 'var(--dsw-alias-bg-module-platform)',
  border: 'var(--dsw-alias-border-l2)',
} as const

const css = {
  card: (open: boolean): React.CSSProperties => ({
    listStyle: 'none',
    border: `1px solid ${open ? tokens.cardOpenBorder : tokens.card}`,
    borderRadius: 12,
    background: open ? tokens.layer2 : tokens.layer3,
    transition: 'border-color .16s, background .16s',
    color: tokens.labelPrimary,
  }),
  header: {
    width: '100%',
    appearance: 'none' as const,
    border: 0,
    background: 'none',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left' as const,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 12,
  },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: tokens.labelPrimary },
  description: { fontSize: 13, lineHeight: 1.5, color: tokens.labelTertiary },
  pending: {
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    lineHeight: '17px',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    background: tokens.moduleBg,
    color: tokens.labelSecondary,
  },
  chevron: (open: boolean): React.CSSProperties => ({
    flex: 'none',
    color: tokens.labelTertiary,
    transform: open ? 'rotate(180deg)' : 'none',
    transition: 'transform .16s',
  }),
  body: { borderTop: `1px solid ${tokens.border}`, margin: '0 16px', paddingBottom: 8 },
  readOnly: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: tokens.labelTertiary },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '12px 0',
    borderTop: `1px solid ${tokens.border}`,
  },
  fieldHead: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: tokens.labelPrimary },
  badges: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  badge: {
    borderRadius: 999,
    padding: '1px 8px',
    fontSize: 11,
    lineHeight: '17px',
    whiteSpace: 'nowrap' as const,
    fontWeight: 500,
    background: tokens.moduleBg,
    color: tokens.labelSecondary,
  },
  reset: {
    border: 'none',
    background: 'none',
    padding: 0,
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.labelSecondary,
    cursor: 'pointer',
  },
  control: {
    boxSizing: 'border-box' as const,
    width: '100%',
    padding: '7px 10px',
    borderRadius: 8,
    border: `1px solid ${tokens.border}`,
    background: tokens.layer3,
    color: tokens.labelPrimary,
    fontSize: 13,
    lineHeight: 1.5,
  },
  controlInvalid: { outline: `2px solid ${tokens.labelError}`, outlineOffset: 0 },
  hint: { fontSize: 12, lineHeight: 1.5, color: tokens.labelTertiary },
  invalidText: { fontSize: 12, lineHeight: 1.5, color: tokens.labelError },
  boolean: { display: 'flex', alignItems: 'center', gap: 10 },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 0 4px', borderTop: `1px solid ${tokens.border}` },
  action: {
    appearance: 'none' as const,
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '5px 14px',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
    color: tokens.labelSecondary,
    background: 'none',
    borderColor: tokens.border,
  },
  actionSave: { background: tokens.labelPrimary, color: tokens.layer3, borderColor: 'transparent' },
  actionDisabled: { opacity: 0.4, cursor: 'default' },
} as const

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={css.chevron(open)} aria-hidden="true">
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Field(props: {
  field: ScholarFieldState
  t: (key: ScholarLocaleKey) => string
  disabled: boolean
  onEdit: (raw: string) => void
  onToggle: (checked: boolean) => void
  onReset: () => void
}) {
  const { field, t, disabled } = props
  // A write-only key control is additionally gated by whether the credentials
  // domain accepts a write for it; it never seeds a draft from a stored value.
  const secretDisabled = field.kind === 'secret' ? disabled || field.writable === false : disabled
  return (
    <div style={css.field}>
      <div style={css.fieldHead}>
        <label style={css.label}>{field.label}</label>
        {field.overridden && (
          <span style={css.badges}>
            <span style={css.badge}>{t('overridden')}</span>
            <button type="button" style={css.reset} disabled={disabled} onClick={props.onReset}>{t('reset')}</button>
          </span>
        )}
        {field.kind === 'secret' && (
          <span style={css.badges}>
            <span style={css.badge}>{field.configured ? t('configured') : t('notConfigured')}</span>
          </span>
        )}
      </div>
      {field.kind === 'boolean' ? (
        <div style={css.boolean}>
          <input
            type="checkbox"
            checked={field.raw === 'true'}
            disabled={disabled}
            aria-label={field.label}
            onChange={(e) => { props.onToggle(e.target.checked) }}
          />
        </div>
      ) : (
        <>
          <input
            type={field.kind === 'secret' ? 'password' : 'text'}
            value={field.raw}
            disabled={secretDisabled}
            placeholder={field.resolvedRaw || undefined}
            aria-label={field.label}
            style={field.invalid ? { ...css.control, ...css.controlInvalid } : css.control}
            onChange={(e) => { props.onEdit(e.target.value) }}
          />
          {field.invalid && <span style={css.invalidText}>{field.invalid}</span>}
        </>
      )}
      <span style={css.hint}>{field.hint}</span>
    </div>
  )
}

/**
 * Render the dsh-scholar-find card, mirroring the shipped plugin-card chrome.
 * @param props - locale copy, the card snapshot hook, and the form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function ScholarCard(props: ScholarCardProps) {
  const [open, setOpen] = useState(false)
  const { t } = props
  const state = props.useScholarCard(snapshot => snapshot)
  if (state.status !== 'ready') return null

  const blocked = !state.dirty || state.invalid || state.saving
  const disabled = !state.writable || state.saving

  return (
    <li style={css.card(open)}>
      <button
        type="button"
        style={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span style={css.headText}>
          <span style={css.name}>{t('title')}</span>
          <span style={css.description}>{t('description')}</span>
        </span>
        {state.dirty && <span style={css.pending}>{t('unsaved')}</span>}
        <Chevron open={open} />
      </button>
      {open && (
        <div style={css.body}>
          {!state.writable && <p style={css.readOnly} role="status">{t('readOnly')}</p>}
          {Object.values(state.fields).map((field) => (
            <Field
              key={field.key}
              field={field}
              t={t}
              disabled={disabled}
              onEdit={(raw) => { props.edit(field.key, raw) }}
              onToggle={(checked) => { props.toggle(field.key, checked) }}
              onReset={() => { props.resetField(field.key) }}
            />
          ))}
          <div style={css.footer}>
            <button
              type="button"
              style={{ ...css.action, ...(state.saving ? css.actionDisabled : {}) }}
              disabled={!state.dirty || state.saving}
              onClick={() => { props.discard() }}
            >
              {t('discard')}
            </button>
            <button
              type="button"
              style={{ ...css.action, ...css.actionSave, ...(blocked ? css.actionDisabled : {}) }}
              disabled={blocked}
              onClick={() => { void props.save() }}
            >
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
