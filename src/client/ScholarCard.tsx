/**
 * The dsh-scholar-find settings page (client half). It renders on the Web UI's
 * Plugins page for this bundle — `plugins.bundle.config`, keyed by the package
 * name — and only while the Host serves the entry, so a deployment without the
 * plugin shows no trace of the page.
 *
 * The page chrome (icon, title, crumb, save-less summary view) belongs to the
 * plugin manager; this file draws the form: the shared frame with its single
 * save, one control per setting, and the three write-only key fields. Controls
 * come from `@deepseek-ai/dsh-client-ui-primitives` (a platform-seeded module),
 * so the page looks and behaves exactly like the shipped ones.
 * @module dsh-scholar-find/client-card
 */

import { Checkbox, SettingsForm, SettingsSecretField, SettingsValueField, type SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScholarCardFace, ScholarFieldKey, ScholarSecretKey } from './controller.js'
import type { ScholarLocaleKey } from './locales.js'

export type ScholarCardProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'dsh-scholar-find'>
  & InjectFace<ScholarCardFace>

/** Hint line copy, matching the shared field atoms' own hint styling. */
const HINT_STYLE = { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } as const

/** Row chrome for the one control that is a switch rather than a value input. */
const BOOLEAN_ROW_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '12px 0',
  borderTop: '0.5px solid var(--dsw-alias-border-l2)',
} as const

/** The frame's copy, read from this page's dictionary. */
function formLabels(t: (key: ScholarLocaleKey) => string): SettingsFormLabels {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/**
 * One boolean setting: a checkbox, its hint, and the override badge every
 * other control gets from the shared field atoms.
 * @param props - label, hint, staged text, and the edit/reset actions.
 * @returns the labelled row.
 */
function BooleanField(props: {
  id: string
  label: string
  hint: string
  text: string
  overridden: boolean
  disabled: boolean
  overriddenLabel: string
  resetLabel: string
  onEdit: (text: string) => void
  onReset: () => void
}): JSX.Element {
  return (
    <div style={BOOLEAN_ROW_STYLE}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Checkbox
          checked={props.text === 'true'}
          disabled={props.disabled}
          label={props.label}
          onChange={(next) => { props.onEdit(next ? 'true' : 'false') }}
        />
        {props.overridden && (
          <button
            type="button"
            disabled={props.disabled}
            onClick={props.onReset}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'none',
              padding: 0,
              font: 'inherit',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--dsw-alias-label-secondary)',
              cursor: 'pointer',
            }}
          >
            {props.resetLabel}
          </button>
        )}
      </div>
      <span style={HINT_STYLE}>{props.hint}</span>
    </div>
  )
}

/**
 * Render the plugin's one-liner or its settings form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function ScholarCard(props: ScholarCardProps): JSX.Element {
  const { t } = props
  const state = props.useScholarCard((snapshot) => snapshot)
  // Bundle configuration renders `page` only; the summary is the bundle's own
  // helper text if the page ever asks for it.
  if (props.view === 'summary') return <>{t('description')}</>
  const disabled = !state.writable || state.saving

  const valueField = (field: ScholarFieldKey, label: ScholarLocaleKey, hint: ScholarLocaleKey, numeric = false) => (
    <SettingsValueField
      key={field}
      id={`scholar-${field}`}
      label={t(label)}
      hint={t(hint)}
      overriddenLabel={t('overridden')}
      resetLabel={t('reset')}
      invalidLabel={t('invalidNumber')}
      numeric={numeric}
      disabled={disabled}
      {...state.fields[field]}
      onEdit={(text) => { props.edit(field, text) }}
      onReset={() => { props.resetField(field) }}
    />
  )

  const secretField = (field: ScholarSecretKey, label: ScholarLocaleKey, hint: ScholarLocaleKey) => {
    const credential = state.credentials[field]
    return (
      <SettingsSecretField
        key={field}
        id={`scholar-${field}`}
        label={t(label)}
        hint={t(hint)}
        text={state.fields[field].text}
        disabled={disabled || credential.writable === false}
        configured={credential.configured}
        stateLabel={credential.configured ? t('configured') : t('notConfigured')}
        onEdit={(text) => { props.edit(field, text) }}
      />
    )
  }

  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      {valueField('unpaywallEmail', 'unpaywallEmail', 'unpaywallEmailHint')}
      {secretField('s2ApiKey', 's2ApiKey', 's2ApiKeyHint')}
      {secretField('astaApiKey', 'astaApiKey', 'astaApiKeyHint')}
      {secretField('sciverseApiKey', 'sciverseApiKey', 'sciverseApiKeyHint')}
      <BooleanField
        id="scholar-cloakEnabled"
        label={t('cloakEnabled')}
        hint={t('cloakEnabledHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        disabled={disabled}
        text={state.fields.cloakEnabled.text}
        overridden={state.fields.cloakEnabled.overridden}
        onEdit={(text) => { props.edit('cloakEnabled', text) }}
        onReset={() => { props.resetField('cloakEnabled') }}
      />
      {valueField('proxyUrl', 'proxyUrl', 'proxyUrlHint')}
      {valueField('defaultOutputDir', 'defaultOutputDir', 'defaultOutputDirHint')}
      {valueField('maxResultsPerSearch', 'maxResultsPerSearch', 'maxResultsPerSearchHint', true)}
      {valueField('fetchTimeoutSec', 'fetchTimeoutSec', 'fetchTimeoutSecHint', true)}
      {valueField('maxPdfSizeMb', 'maxPdfSizeMb', 'maxPdfSizeMbHint', true)}
      {valueField('s2RequestGapMs', 's2RequestGapMs', 's2RequestGapMsHint', true)}
    </SettingsForm>
  )
}
