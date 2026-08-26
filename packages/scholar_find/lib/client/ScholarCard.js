import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The dsh-scholar-find settings card (client half). Rendered inside the Plugins
 * configuration tab for the `dsh-scholar-find` namespace via the
 * `settings.plugin.item` keyed slot. The markup and design tokens mirror the
 * shipped `PluginCard`/`ValueField` cards so it reads as part of the same
 * surface (the shipped components are not publicly exportable, so the card
 * draws its own DOM using the same `--dsw-alias-*` theme variables).
 * @module dsh-scholar-find/client-card
 */
import { useState } from 'react';
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
};
const css = {
    card: (open) => ({
        listStyle: 'none',
        border: `1px solid ${open ? tokens.cardOpenBorder : tokens.card}`,
        borderRadius: 12,
        background: open ? tokens.layer2 : tokens.layer3,
        transition: 'border-color .16s, background .16s',
        color: tokens.labelPrimary,
    }),
    header: {
        width: '100%',
        appearance: 'none',
        border: 0,
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
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
        whiteSpace: 'nowrap',
        background: tokens.moduleBg,
        color: tokens.labelSecondary,
    },
    chevron: (open) => ({
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
        whiteSpace: 'nowrap',
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
        boxSizing: 'border-box',
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
        appearance: 'none',
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
};
function Chevron({ open }) {
    return (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 14 14", style: css.chevron(open), "aria-hidden": "true", children: _jsx("path", { d: "M3 5l4 4 4-4", stroke: "currentColor", strokeWidth: "1.5", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function Field(props) {
    const { field, t, disabled } = props;
    return (_jsxs("div", { style: css.field, children: [_jsxs("div", { style: css.fieldHead, children: [_jsx("label", { style: css.label, children: field.label }), field.overridden && (_jsxs("span", { style: css.badges, children: [_jsx("span", { style: css.badge, children: t('overridden') }), _jsx("button", { type: "button", style: css.reset, disabled: disabled, onClick: props.onReset, children: t('reset') })] }))] }), field.kind === 'boolean' ? (_jsx("div", { style: css.boolean, children: _jsx("input", { type: "checkbox", checked: field.raw === 'true', disabled: disabled, "aria-label": field.label, onChange: (e) => { props.onToggle(e.target.checked); } }) })) : (_jsxs(_Fragment, { children: [_jsx("input", { type: field.kind === 'secret' ? 'password' : 'text', value: field.raw, disabled: disabled, placeholder: field.resolvedRaw || undefined, "aria-label": field.label, style: field.invalid ? { ...css.control, ...css.controlInvalid } : css.control, onChange: (e) => { props.onEdit(e.target.value); } }), field.invalid && _jsx("span", { style: css.invalidText, children: field.invalid })] })), _jsx("span", { style: css.hint, children: field.hint })] }));
}
/**
 * Render the dsh-scholar-find card, mirroring the shipped plugin-card chrome.
 * @param props - locale copy, the card snapshot hook, and the form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function ScholarCard(props) {
    const [open, setOpen] = useState(false);
    const { t } = props;
    const state = props.useScholarCard(snapshot => snapshot);
    if (state.status !== 'ready')
        return null;
    const blocked = !state.dirty || state.invalid || state.saving;
    const disabled = !state.writable || state.saving;
    return (_jsxs("li", { style: css.card(open), children: [_jsxs("button", { type: "button", style: css.header, "aria-expanded": open, "aria-label": `${t(open ? 'collapse' : 'expand')}: ${t('title')}`, onClick: () => { setOpen(!open); }, children: [_jsxs("span", { style: css.headText, children: [_jsx("span", { style: css.name, children: t('title') }), _jsx("span", { style: css.description, children: t('description') })] }), state.dirty && _jsx("span", { style: css.pending, children: t('unsaved') }), _jsx(Chevron, { open: open })] }), open && (_jsxs("div", { style: css.body, children: [!state.writable && _jsx("p", { style: css.readOnly, role: "status", children: t('readOnly') }), Object.values(state.fields).map((field) => (_jsx(Field, { field: field, t: t, disabled: disabled, onEdit: (raw) => { props.edit(field.key, raw); }, onToggle: (checked) => { props.toggle(field.key, checked); }, onReset: () => { props.resetField(field.key); } }, field.key))), _jsxs("div", { style: css.footer, children: [_jsx("button", { type: "button", style: { ...css.action, ...(state.saving ? css.actionDisabled : {}) }, disabled: !state.dirty || state.saving, onClick: () => { props.discard(); }, children: t('discard') }), _jsx("button", { type: "button", style: { ...css.action, ...css.actionSave, ...(blocked ? css.actionDisabled : {}) }, disabled: blocked, onClick: () => { void props.save(); }, children: t(state.saving ? 'saving' : 'save') })] })] }))] }));
}
//# sourceMappingURL=ScholarCard.js.map