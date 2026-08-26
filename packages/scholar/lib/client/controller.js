/**
 * The dsh-scholar card controller (client half): a small zustand-free
 * snapshot store plus the form logic driven by a bound settings scope.
 * Mirrors the pattern of the shipped plugin cards without importing their
 * internal utilities (client bundle purity). The scope is consumed
 * structurally so the bundle never value-imports a DSH client package.
 * @module dsh-scholar/client-controller
 */
/** Minimal observable snapshot store (no external store dependency). */
class SnapshotStoreImpl {
    state;
    listeners = new Set();
    constructor(initial) {
        this.state = initial;
    }
    getSnapshot() {
        return this.state;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    set(next) {
        this.state = next;
        for (const listener of this.listeners)
            listener();
    }
    update(mutator) {
        const draft = structuredClone(this.state);
        mutator(draft);
        this.set(draft);
    }
}
function textOf(value) {
    if (value === undefined || value === null)
        return '';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    return String(value);
}
export class ScholarCardController {
    scope;
    specs;
    t;
    /** State machine for the write latch: a save cannot overlap itself. */
    writing = Promise.resolve();
    store = new SnapshotStoreImpl({
        status: 'loading',
        writable: false,
        dirty: false,
        invalid: false,
        saving: false,
        fields: {},
    });
    constructor(scope, specs, t) {
        this.scope = scope;
        this.specs = specs;
        this.t = t;
        scope.subscribe(() => this.rebase());
        this.rebase();
    }
    /** The injected face: actions + the snapshot-store hooks compartment. */
    inject() {
        return {
            save: () => this.save(),
            discard: () => this.discard(),
            edit: (field, raw) => this.edit(field, raw),
            toggle: (field, checked) => this.toggle(field, checked),
            resetField: (field) => this.resetField(field),
            hooks: { scholarCard: this.store },
        };
    }
    snapshot() {
        return this.store.getSnapshot();
    }
    view() {
        const view = this.scope.getSnapshot();
        return {
            value: (view.value ?? {}),
            base: (view.base ?? {}),
            user: (view.user ?? {}),
            writable: Boolean(view.writable),
        };
    }
    rebase() {
        const status = this.scope.getSnapshot().status;
        if (status === 'loading')
            return;
        if (status !== 'ready') {
            this.store.set({ status: 'unavailable', writable: false, dirty: false, invalid: false, saving: false, fields: {} });
            return;
        }
        const { value, base, user, writable } = this.view();
        const resolvedOf = (key) => textOf(value[key] ?? base[key]);
        this.store.update((draft) => {
            draft.status = 'ready';
            draft.writable = writable;
            for (const spec of this.specs) {
                const current = draft.fields[spec.key];
                draft.fields[spec.key] = {
                    key: spec.key,
                    kind: spec.kind,
                    label: this.t(spec.key),
                    hint: this.t(`${spec.key}Hint`),
                    raw: current?.raw ?? resolvedOf(spec.key),
                    resolvedRaw: resolvedOf(spec.key),
                    overridden: Object.hasOwn(user, spec.key),
                    invalid: current?.invalid,
                };
            }
            this.refreshValidity(draft);
        });
    }
    refreshValidity(draft) {
        let anyInvalid = false;
        for (const spec of this.specs) {
            const field = draft.fields[spec.key];
            if (!field)
                continue;
            if (spec.kind === 'number' && field.raw !== '') {
                field.invalid = Number.isFinite(Number(field.raw)) ? undefined : this.t('invalidNumber');
            }
            if (field.invalid !== undefined)
                anyInvalid = true;
        }
        const { value, base } = this.view();
        draft.dirty = this.specs.some((spec) => {
            const field = draft.fields[spec.key];
            return Boolean(field && field.raw !== textOf(value[spec.key] ?? base[spec.key]));
        });
        draft.invalid = anyInvalid;
    }
    edit(field, raw) {
        this.store.update((draft) => {
            if (draft.fields[field])
                draft.fields[field].raw = raw;
            this.refreshValidity(draft);
        });
    }
    toggle(field, checked) {
        this.edit(field, checked ? 'true' : 'false');
    }
    discard() {
        this.rebase();
    }
    resetField(field) {
        void this.scope.unset(field);
    }
    save() {
        const snapshot = this.snapshot();
        if (!snapshot.dirty || snapshot.invalid || snapshot.saving)
            return Promise.resolve();
        this.store.update((draft) => { draft.saving = true; });
        this.writing = this.writing.then(async () => {
            const { value, base } = this.view();
            const writes = [];
            for (const spec of this.specs) {
                const field = this.store.getSnapshot().fields[spec.key];
                if (!field || field.raw === textOf(value[spec.key] ?? base[spec.key]))
                    continue;
                if (field.raw === '') {
                    writes.push(this.scope.unset(spec.key));
                    continue;
                }
                const parsed = spec.kind === 'number' ? Number(field.raw) : spec.kind === 'boolean' ? field.raw === 'true' : field.raw;
                writes.push(this.scope.set(spec.key, parsed));
            }
            await Promise.all(writes);
            this.store.update((draft) => { draft.saving = false; });
        });
        return this.writing;
    }
}
//# sourceMappingURL=controller.js.map