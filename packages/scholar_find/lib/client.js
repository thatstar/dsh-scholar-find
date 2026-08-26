window.__ModuleLoader__.load({
  id: 'dsh-scholar-find',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);

// src/client/ScholarCard.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var tokens = {
  card: "var(--dsw-alias-border-l2)",
  cardOpenBorder: "var(--dsw-alias-label-dimmed)",
  layer3: "var(--dsw-alias-bg-layer-3)",
  layer2: "var(--dsw-alias-bg-layer-2)",
  labelPrimary: "var(--dsw-alias-label-primary)",
  labelSecondary: "var(--dsw-alias-label-secondary)",
  labelTertiary: "var(--dsw-alias-label-tertiary)",
  labelError: "var(--dsw-alias-label-error)",
  brand: "var(--dsw-alias-brand-primary)",
  moduleBg: "var(--dsw-alias-bg-module-platform)",
  border: "var(--dsw-alias-border-l2)"
};
var css = {
  card: (open) => ({
    listStyle: "none",
    border: `1px solid ${open ? tokens.cardOpenBorder : tokens.card}`,
    borderRadius: 12,
    background: open ? tokens.layer2 : tokens.layer3,
    transition: "border-color .16s, background .16s",
    color: tokens.labelPrimary
  }),
  header: {
    width: "100%",
    appearance: "none",
    border: 0,
    background: "none",
    font: "inherit",
    color: "inherit",
    textAlign: "left",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 12
  },
  headText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: tokens.labelPrimary },
  description: { fontSize: 13, lineHeight: 1.5, color: tokens.labelTertiary },
  pending: {
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
    lineHeight: "17px",
    fontWeight: 500,
    whiteSpace: "nowrap",
    background: tokens.moduleBg,
    color: tokens.labelSecondary
  },
  chevron: (open) => ({
    flex: "none",
    color: tokens.labelTertiary,
    transform: open ? "rotate(180deg)" : "none",
    transition: "transform .16s"
  }),
  body: { borderTop: `1px solid ${tokens.border}`, margin: "0 16px", paddingBottom: 8 },
  readOnly: { margin: "12px 0 0", fontSize: 12, lineHeight: 1.5, color: tokens.labelTertiary },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 0",
    borderTop: `1px solid ${tokens.border}`
  },
  fieldHead: { display: "flex", alignItems: "center", gap: 8 },
  label: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: tokens.labelPrimary },
  badges: { display: "inline-flex", alignItems: "center", gap: 8 },
  badge: {
    borderRadius: 999,
    padding: "1px 8px",
    fontSize: 11,
    lineHeight: "17px",
    whiteSpace: "nowrap",
    fontWeight: 500,
    background: tokens.moduleBg,
    color: tokens.labelSecondary
  },
  reset: {
    border: "none",
    background: "none",
    padding: 0,
    font: "inherit",
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.labelSecondary,
    cursor: "pointer"
  },
  control: {
    boxSizing: "border-box",
    width: "100%",
    padding: "7px 10px",
    borderRadius: 8,
    border: `1px solid ${tokens.border}`,
    background: tokens.layer3,
    color: tokens.labelPrimary,
    fontSize: 13,
    lineHeight: 1.5
  },
  controlInvalid: { outline: `2px solid ${tokens.labelError}`, outlineOffset: 0 },
  hint: { fontSize: 12, lineHeight: 1.5, color: tokens.labelTertiary },
  invalidText: { fontSize: 12, lineHeight: 1.5, color: tokens.labelError },
  boolean: { display: "flex", alignItems: "center", gap: 10 },
  footer: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: "12px 0 4px", borderTop: `1px solid ${tokens.border}` },
  action: {
    appearance: "none",
    border: "1px solid transparent",
    borderRadius: 8,
    padding: "5px 14px",
    font: "inherit",
    fontSize: 13,
    lineHeight: 1.5,
    cursor: "pointer",
    color: tokens.labelSecondary,
    background: "none",
    borderColor: tokens.border
  },
  actionSave: { background: tokens.labelPrimary, color: tokens.layer3, borderColor: "transparent" },
  actionDisabled: { opacity: 0.4, cursor: "default" },
  warning: {
    margin: "12px 0 0",
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.labelError
  }
};
function Chevron({ open }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "14", height: "14", viewBox: "0 0 14 14", style: css.chevron(open), "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M3 5l4 4 4-4", stroke: "currentColor", strokeWidth: "1.5", fill: "none", strokeLinecap: "round", strokeLinejoin: "round" }) });
}
function Field(props) {
  const { field, t, disabled } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: css.field, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: css.fieldHead, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: css.label, children: field.label }),
      field.overridden && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: css.badges, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: css.badge, children: t("overridden") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", style: css.reset, disabled, onClick: props.onReset, children: t("reset") })
      ] })
    ] }),
    field.kind === "boolean" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: css.boolean, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "input",
      {
        type: "checkbox",
        checked: field.raw === "true",
        disabled,
        "aria-label": field.label,
        onChange: (e) => {
          props.onToggle(e.target.checked);
        }
      }
    ) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          type: field.kind === "secret" ? "password" : "text",
          value: field.raw,
          disabled,
          placeholder: field.resolvedRaw || void 0,
          "aria-label": field.label,
          style: field.invalid ? { ...css.control, ...css.controlInvalid } : css.control,
          onChange: (e) => {
            props.onEdit(e.target.value);
          }
        }
      ),
      field.invalid && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: css.invalidText, children: field.invalid })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: css.hint, children: field.hint })
  ] });
}
function ScholarCard(props) {
  const [open, setOpen] = (0, import_react.useState)(false);
  const { t } = props;
  const state = props.useScholarCard((snapshot) => snapshot);
  if (state.status !== "ready") return null;
  const blocked = !state.dirty || state.invalid || state.saving;
  const disabled = !state.writable || state.saving;
  const email = state.fields.unpaywallEmail;
  const emailEmpty = email !== void 0 && email.raw === "" && email.resolvedRaw === "";
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: css.card(open), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        style: css.header,
        "aria-expanded": open,
        "aria-label": `${t(open ? "collapse" : "expand")}: ${t("title")}`,
        onClick: () => {
          setOpen(!open);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: css.headText, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: css.name, children: t("title") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: css.description, children: t("description") })
          ] }),
          state.dirty && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: css.pending, children: t("unsaved") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Chevron, { open })
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: css.body, children: [
      !state.writable && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: css.readOnly, role: "status", children: t("readOnly") }),
      emailEmpty && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: css.warning, role: "status", children: t("unpaywallEmailWarning") }),
      Object.values(state.fields).map((field) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Field,
        {
          field,
          t,
          disabled,
          onEdit: (raw) => {
            props.edit(field.key, raw);
          },
          onToggle: (checked) => {
            props.toggle(field.key, checked);
          },
          onReset: () => {
            props.resetField(field.key);
          }
        },
        field.key
      )),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: css.footer, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            style: { ...css.action, ...state.saving ? css.actionDisabled : {} },
            disabled: !state.dirty || state.saving,
            onClick: () => {
              props.discard();
            },
            children: t("discard")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            style: { ...css.action, ...css.actionSave, ...blocked ? css.actionDisabled : {} },
            disabled: blocked,
            onClick: () => {
              void props.save();
            },
            children: t(state.saving ? "saving" : "save")
          }
        )
      ] })
    ] })
  ] });
}

// src/client/controller.ts
var SnapshotStoreImpl = class {
  state;
  listeners = /* @__PURE__ */ new Set();
  constructor(initial) {
    this.state = initial;
  }
  getSnapshot() {
    return this.state;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  set(next) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  update(mutator) {
    const draft = structuredClone(this.state);
    mutator(draft);
    this.set(draft);
  }
};
function textOf(value) {
  if (value === void 0 || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
var ScholarCardController = class {
  constructor(scope, specs, t) {
    this.scope = scope;
    this.specs = specs;
    this.t = t;
    scope.subscribe(() => this.rebase());
    this.rebase();
  }
  /** State machine for the write latch: a save cannot overlap itself. */
  writing = Promise.resolve();
  store = new SnapshotStoreImpl({
    status: "loading",
    writable: false,
    dirty: false,
    invalid: false,
    saving: false,
    fields: {}
  });
  /** The injected face: actions + the snapshot-store hooks compartment. */
  inject() {
    return {
      save: () => this.save(),
      discard: () => this.discard(),
      edit: (field, raw) => this.edit(field, raw),
      toggle: (field, checked) => this.toggle(field, checked),
      resetField: (field) => this.resetField(field),
      hooks: { scholarCard: this.store }
    };
  }
  snapshot() {
    return this.store.getSnapshot();
  }
  view() {
    const view = this.scope.getSnapshot();
    return {
      value: view.value ?? {},
      base: view.base ?? {},
      user: view.user ?? {},
      writable: Boolean(view.writable)
    };
  }
  rebase() {
    const status = this.scope.getSnapshot().status;
    if (status === "loading") return;
    if (status !== "ready") {
      this.store.set({ status: "unavailable", writable: false, dirty: false, invalid: false, saving: false, fields: {} });
      return;
    }
    const { value, base, user, writable } = this.view();
    const resolvedOf = (key) => textOf(value[key] ?? base[key]);
    this.store.update((draft) => {
      draft.status = "ready";
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
          invalid: current?.invalid
        };
      }
      this.refreshValidity(draft);
    });
  }
  refreshValidity(draft) {
    let anyInvalid = false;
    for (const spec of this.specs) {
      const field = draft.fields[spec.key];
      if (!field) continue;
      if (spec.kind === "number" && field.raw !== "") {
        field.invalid = Number.isFinite(Number(field.raw)) ? void 0 : this.t("invalidNumber");
      }
      if (field.invalid !== void 0) anyInvalid = true;
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
      if (draft.fields[field]) draft.fields[field].raw = raw;
      this.refreshValidity(draft);
    });
  }
  toggle(field, checked) {
    this.edit(field, checked ? "true" : "false");
  }
  discard() {
    this.rebase();
  }
  resetField(field) {
    void this.scope.unset(field);
  }
  save() {
    const snapshot = this.snapshot();
    if (!snapshot.dirty || snapshot.invalid || snapshot.saving) return Promise.resolve();
    this.store.update((draft) => {
      draft.saving = true;
    });
    this.writing = this.writing.then(async () => {
      const { value, base } = this.view();
      const writes = [];
      for (const spec of this.specs) {
        const field = this.store.getSnapshot().fields[spec.key];
        if (!field || field.raw === textOf(value[spec.key] ?? base[spec.key])) continue;
        if (field.raw === "") {
          writes.push(this.scope.unset(spec.key));
          continue;
        }
        const parsed = spec.kind === "number" ? Number(field.raw) : spec.kind === "boolean" ? field.raw === "true" : field.raw;
        writes.push(this.scope.set(spec.key, parsed));
      }
      await Promise.all(writes);
      this.store.update((draft) => {
        draft.saving = false;
      });
    });
    return this.writing;
  }
};

// src/client/locales.ts
var NS = "dsh-scholar-find";
var en = {
  title: "Scholar",
  description: "Semantic Scholar search and open-access PDF fetch.",
  save: "Save",
  saving: "Saving\u2026",
  discard: "Discard",
  overridden: "Overridden",
  reset: "Reset",
  unsaved: "Unsaved",
  expand: "Show settings",
  collapse: "Hide settings",
  readOnly: "This deployment stores settings read-only.",
  invalidNumber: "Enter a number, or leave blank to use the default.",
  unpaywallEmail: "Unpaywall contact email",
  unpaywallEmailHint: "Enables the Unpaywall source (also Crossref politeness). Empty means Unpaywall is skipped.",
  unpaywallEmailWarning: "No email set: Unpaywall is skipped and fetch coverage is reduced.",
  s2ApiKeyRef: "Semantic Scholar API key reference",
  s2ApiKeyRefHint: "Credential record name in ~/.dsh/.credentials.yaml (e.g. S2_API_KEY). Empty = anonymous (5 s pacing).",
  scihubEnabled: "Sci-Hub fallback",
  scihubEnabledHint: "Last-resort non-OA fallback. Off by default.",
  institutionalEnabled: "Institutional (publisher-direct) mode",
  institutionalEnabledHint: "Requires your own subscription access (on-campus/VPN).",
  scihubMirrors: "Sci-Hub mirror override",
  scihubMirrorsHint: "Comma-separated hostnames; empty = built-in list.",
  pdfOutputDir: "PDF output directory",
  pdfOutputDirHint: "Relative paths resolve against the session workspace.",
  maxResultsPerSearch: "Default results per search",
  maxResultsPerSearchHint: "Result cap used by scholar_search_* tools (max 1000).",
  fetchTimeoutSec: "HTTP timeout (seconds)",
  fetchTimeoutSecHint: "Per-request timeout for searches and downloads.",
  maxPdfSizeMb: "PDF size cap (MB)",
  maxPdfSizeMbHint: "Larger responses are rejected.",
  s2RequestGapMs: "S2 pacing override (ms)",
  s2RequestGapMsHint: "0 = auto (1100 ms with key, 5000 ms anonymous)."
};
var zh = {
  title: "Scholar \u5B66\u672F\u641C\u7D22",
  description: "Semantic Scholar \u8BBA\u6587\u68C0\u7D22\u4E0E\u5F00\u653E\u83B7\u53D6 PDF \u4E0B\u8F7D\u3002",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  discard: "\u653E\u5F03\u4FEE\u6539",
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u6062\u590D\u9ED8\u8BA4",
  unsaved: "\u672A\u4FDD\u5B58",
  expand: "\u663E\u793A\u8BBE\u7F6E",
  collapse: "\u6536\u8D77\u8BBE\u7F6E",
  readOnly: "\u5F53\u524D\u90E8\u7F72\u4EE5\u53EA\u8BFB\u65B9\u5F0F\u5B58\u50A8\u8BBE\u7F6E\u3002",
  invalidNumber: "\u8BF7\u586B\u6570\u5B57\uFF1B\u7559\u7A7A\u8868\u793A\u4F7F\u7528\u9ED8\u8BA4\u503C\u3002",
  unpaywallEmail: "Unpaywall \u8054\u7CFB\u90AE\u7BB1",
  unpaywallEmailHint: "\u542F\u7528 Unpaywall \u6765\u6E90\uFF08\u540C\u65F6\u7528\u4F5C Crossref \u793C\u8C8C\u6C60\u90AE\u7BB1\uFF09\u3002\u7559\u7A7A\u5219\u8DF3\u8FC7 Unpaywall\u3002",
  unpaywallEmailWarning: "\u672A\u8BBE\u7F6E\u90AE\u7BB1\uFF1AUnpaywall \u5C06\u88AB\u8DF3\u8FC7\uFF0C\u4E0B\u8F7D\u8986\u76D6\u7387\u4E0B\u964D\u3002",
  s2ApiKeyRef: "Semantic Scholar API \u5BC6\u94A5\u5F15\u7528",
  s2ApiKeyRefHint: "~/.dsh/.credentials.yaml \u4E2D\u7684\u51ED\u636E\u8BB0\u5F55\u540D\uFF08\u5982 S2_API_KEY\uFF09\u3002\u7559\u7A7A = \u533F\u540D\u6A21\u5F0F\uFF085 \u79D2\u95F4\u9694\uFF09\u3002",
  scihubEnabled: "Sci-Hub \u515C\u5E95",
  scihubEnabledHint: "\u975E\u5F00\u653E\u83B7\u53D6\u7684\u6700\u540E\u515C\u5E95\u6765\u6E90\u3002\u9ED8\u8BA4\u5173\u95ED\u3002",
  institutionalEnabled: "\u673A\u6784\u6A21\u5F0F\uFF08\u51FA\u7248\u793E\u76F4\u8FDE\uFF09",
  institutionalEnabledHint: "\u9700\u8981\u60A8\u81EA\u5DF1\u7684\u8BA2\u9605\u8BBF\u95EE\u6743\u9650\uFF08\u6821\u56ED\u7F51/VPN\uFF09\u3002",
  scihubMirrors: "Sci-Hub \u955C\u50CF\u8986\u76D6",
  scihubMirrorsHint: "\u9017\u53F7\u5206\u9694\u7684\u4E3B\u673A\u540D\uFF1B\u7559\u7A7A\u4F7F\u7528\u5185\u7F6E\u5217\u8868\u3002",
  pdfOutputDir: "PDF \u8F93\u51FA\u76EE\u5F55",
  pdfOutputDirHint: "\u76F8\u5BF9\u8DEF\u5F84\u57FA\u4E8E\u5F53\u524D\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u89E3\u6790\u3002",
  maxResultsPerSearch: "\u9ED8\u8BA4\u641C\u7D22\u7ED3\u679C\u6570",
  maxResultsPerSearchHint: "scholar_search_* \u5DE5\u5177\u7684\u9ED8\u8BA4\u7ED3\u679C\u4E0A\u9650\uFF08\u6700\u5927 1000\uFF09\u3002",
  fetchTimeoutSec: "HTTP \u8D85\u65F6\uFF08\u79D2\uFF09",
  fetchTimeoutSecHint: "\u641C\u7D22\u4E0E\u4E0B\u8F7D\u7684\u5355\u4E2A\u8BF7\u6C42\u8D85\u65F6\u3002",
  maxPdfSizeMb: "PDF \u5927\u5C0F\u4E0A\u9650\uFF08MB\uFF09",
  maxPdfSizeMbHint: "\u8D85\u8FC7\u8BE5\u5927\u5C0F\u7684\u54CD\u5E94\u4F1A\u88AB\u62D2\u7EDD\u3002",
  s2RequestGapMs: "S2 \u8BF7\u6C42\u95F4\u9694\u8986\u76D6\uFF08\u6BEB\u79D2\uFF09",
  s2RequestGapMsHint: "0 = \u81EA\u52A8\uFF08\u6709\u5BC6\u94A5 1100 \u6BEB\u79D2\uFF0C\u533F\u540D 5000 \u6BEB\u79D2\uFF09\u3002"
};

// src/client/index.ts
var name = "dsh-scholar-find-client";
var inject = ["slots", "settingsScope", "locale"];
var FIELD_SPECS = [
  { key: "unpaywallEmail", kind: "text" },
  { key: "s2ApiKeyRef", kind: "secret" },
  { key: "scihubEnabled", kind: "boolean" },
  { key: "institutionalEnabled", kind: "boolean" },
  { key: "scihubMirrors", kind: "text" },
  { key: "pdfOutputDir", kind: "text" },
  { key: "maxResultsPerSearch", kind: "number" },
  { key: "fetchTimeoutSec", kind: "number" },
  { key: "maxPdfSizeMb", kind: "number" },
  { key: "s2RequestGapMs", kind: "number" }
];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-scholar-find: card dictionaries");
  const t = ctx.locale.bind(NS);
  const scope = ctx.settingsScope.bind({ namespace: NS });
  const controller = new ScholarCardController(scope, FIELD_SPECS, (key) => t(key));
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    key: NS,
    locale: NS,
    inject: () => controller.inject()
  }, ScholarCard));
}

    return module.exports;
  }
});
