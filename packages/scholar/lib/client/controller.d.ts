/**
 * The dsh-scholar card controller (client half): a small zustand-free
 * snapshot store plus the form logic driven by a bound settings scope.
 * Mirrors the pattern of the shipped plugin cards without importing their
 * internal utilities (client bundle purity). The scope is consumed
 * structurally so the bundle never value-imports a DSH client package.
 * @module dsh-scholar/client-controller
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
/** One editable field of the card. */
export type ScholarFieldKind = 'text' | 'secret' | 'number' | 'boolean';
export interface ScholarFieldSpec {
    key: string;
    kind: ScholarFieldKind;
}
/** One field's staged state as the card renders it. */
export interface ScholarFieldState {
    key: string;
    kind: ScholarFieldKind;
    label: string;
    hint: string;
    /** Staged raw text ('' = not edited / inherit). Booleans stage 'true'/'false'. */
    raw: string;
    /** The current resolved value as text. */
    resolvedRaw: string;
    /** Whether the user layer overrides this field. */
    overridden: boolean;
    /** Localized invalid message; undefined when the staged value parses. */
    invalid?: string;
}
/** Card snapshot handed to the component. */
export interface ScholarCardSnapshot {
    status: 'loading' | 'ready' | 'unavailable';
    writable: boolean;
    dirty: boolean;
    invalid: boolean;
    saving: boolean;
    fields: Record<string, ScholarFieldState>;
}
/** The face the slot registration injects (hooks compartment -> useScholarCard). */
export interface ScholarCardFace {
    save(): Promise<void>;
    discard(): void;
    edit(field: string, raw: string): void;
    toggle(field: string, checked: boolean): void;
    resetField(field: string): void;
    hooks: {
        scholarCard: SnapshotStore<ScholarCardSnapshot>;
    };
}
/** Structural view of the settings scope the card controller consumes. */
export interface ScholarScopeLike {
    getSnapshot(): {
        status: 'loading' | 'ready' | 'unavailable' | string;
        writable: boolean;
        value?: unknown;
        base?: unknown;
        user?: Record<string, unknown>;
    };
    subscribe(fn: () => void): () => void;
    set(field: string, value: unknown): Promise<void>;
    unset(field: string): Promise<void>;
}
export declare class ScholarCardController {
    private readonly scope;
    private readonly specs;
    private readonly t;
    /** State machine for the write latch: a save cannot overlap itself. */
    private writing;
    private readonly store;
    constructor(scope: ScholarScopeLike, specs: readonly ScholarFieldSpec[], t: (key: string) => string);
    /** The injected face: actions + the snapshot-store hooks compartment. */
    inject(): ScholarCardFace;
    private snapshot;
    private view;
    private rebase;
    private refreshValidity;
    edit(field: string, raw: string): void;
    toggle(field: string, checked: boolean): void;
    discard(): void;
    resetField(field: string): void;
    save(): Promise<void>;
}
