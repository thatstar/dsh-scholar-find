import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The dsh-scholar settings card (client half). Rendered inside the Plugins
 * configuration tab for the `dsh-scholar` namespace via the
 * `settings.plugin.item` keyed slot. Plain React; no CSS modules (the card
 * is self-contained so the served client bundle owns all of its styles).
 * @module dsh-scholar/client-card
 */
import { useState } from 'react';
const styles = {
    card: {
        listStyle: 'none',
        border: '1px solid var(--dsh-border, #333)',
        borderRadius: 8,
        padding: '12px 14px',
        margin: '8px 0',
        background: 'var(--dsh-surface, #1c1c1c)',
        color: 'var(--dsh-text, #eee)',
    },
    header: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
    title: { fontWeight: 600, fontSize: 14 },
    description: { opacity: 0.7, fontSize: 12 },
    badge: {
        fontSize: 11,
        padding: '1px 8px',
        borderRadius: 10,
        border: '1px solid currentColor',
        opacity: 0.8,
    },
    warning: { fontSize: 12, color: '#e2b93d', margin: '8px 0 0' },
    field: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 },
    fieldLabel: { fontSize: 12, fontWeight: 500 },
    fieldHint: { fontSize: 11, opacity: 0.65 },
    input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsh-border, #444)',
        background: 'var(--dsh-input, #262626)',
        color: 'inherit',
        fontSize: 13,
    },
    inputInvalid: { outline: '1px solid #d9534f' },
    invalidText: { fontSize: 11, color: '#d9534f' },
    row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10 },
    actions: { display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' },
    button: {
        padding: '5px 14px',
        borderRadius: 6,
        border: '1px solid var(--dsh-border, #555)',
        background: 'var(--dsh-button, #2c2c2c)',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 13,
    },
    buttonPrimary: { background: '#0b6bcb', borderColor: '#0b6bcb', color: '#fff' },
};
/**
 * Render the dsh-scholar card.
 * @param props - locale copy, the card snapshot hook, and the form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function ScholarCard(props) {
    const [open, setOpen] = useState(false);
    const { t } = props;
    const state = props.useScholarCard(snapshot => snapshot);
    if (state.status !== 'ready')
        return null;
    const disabled = !state.writable || state.saving;
    const email = state.fields.unpaywallEmail;
    const emailEmpty = email !== undefined && email.raw === '' && email.resolvedRaw === '';
    return (_jsxs("li", { style: styles.card, children: [_jsxs("div", { style: styles.header, children: [_jsxs("button", { type: "button", "aria-expanded": open, onClick: () => { setOpen(!open); }, style: { ...styles.button, fontSize: 14, fontWeight: 600 }, children: [open ? '▾' : '▸', " ", t('title')] }), _jsx("span", { style: styles.description, children: t('description') }), state.dirty && _jsx("span", { style: styles.badge, children: t('saving') })] }), emailEmpty && _jsx("p", { style: styles.warning, children: t('unpaywallEmailWarning') }), open && (_jsxs("div", { children: [Object.values(state.fields).map((field) => (_jsxs("div", { style: styles.field, children: [_jsxs("label", { style: styles.fieldLabel, children: [field.label, field.overridden && _jsxs("span", { style: { marginLeft: 8, fontSize: 11, opacity: 0.8 }, children: ["\u00B7 ", t('overridden')] })] }), field.kind === 'boolean' ? (_jsxs("div", { style: styles.row, children: [_jsx("span", { style: styles.fieldHint, children: field.hint }), _jsx("input", { type: "checkbox", checked: field.raw === 'true', disabled: disabled, onChange: (e) => { props.toggle(field.key, e.target.checked); } })] })) : (_jsxs(_Fragment, { children: [_jsx("input", { type: field.kind === 'secret' ? 'password' : 'text', value: field.raw, disabled: disabled, placeholder: field.resolvedRaw, "aria-label": field.label, style: { ...styles.input, ...(field.invalid ? styles.inputInvalid : {}) }, onChange: (e) => { props.edit(field.key, e.target.value); } }), field.invalid && _jsx("span", { style: styles.invalidText, children: field.invalid })] })), _jsx("span", { style: styles.fieldHint, children: field.hint }), (field.overridden || field.raw !== field.resolvedRaw) && (_jsx("button", { type: "button", style: styles.button, disabled: disabled, onClick: () => { props.resetField(field.key); }, children: t('reset') }))] }, field.key))), _jsxs("div", { style: styles.actions, children: [_jsx("button", { type: "button", style: styles.button, disabled: !state.dirty || disabled, onClick: () => { props.discard(); }, children: t('discard') }), _jsx("button", { type: "button", style: { ...styles.button, ...styles.buttonPrimary }, disabled: !state.dirty || state.invalid || disabled, onClick: () => { void props.save(); }, children: state.saving ? t('saving') : t('save') })] })] }))] }));
}
//# sourceMappingURL=ScholarCard.js.map