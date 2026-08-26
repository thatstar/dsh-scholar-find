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
  actionDisabled: { opacity: 0.4, cursor: "default" }
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
  title: "Scholar Retrieval",
  description: "Semantic Scholar search and open-access PDF fetch.",
  save: "Save",
  saving: "Saving…",
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
  title: "学术检索",
  description: "Semantic Scholar 论文检索与开放获取 PDF 下载。",
  save: "保存",
  saving: "保存中…",
  discard: "放弃修改",
  overridden: "已覆盖",
  reset: "恢复默认",
  unsaved: "未保存",
  expand: "显示设置",
  collapse: "收起设置",
  readOnly: "当前部署以只读方式存储设置。",
  invalidNumber: "请填数字；留空表示使用默认值。",
  unpaywallEmail: "Unpaywall 联系邮箱",
  unpaywallEmailHint: "启用 Unpaywall 来源（同时用作 Crossref 礼貌池邮箱）。留空则跳过 Unpaywall。",
  s2ApiKeyRef: "Semantic Scholar API 密钥引用",
  s2ApiKeyRefHint: "~/.dsh/.credentials.yaml 中的凭据记录名（如 S2_API_KEY）。留空 = 匿名模式（5 秒间隔）。",
  scihubEnabled: "Sci-Hub 兜底",
  scihubEnabledHint: "非开放获取的最后兜底来源。默认关闭。",
  institutionalEnabled: "机构模式（出版社直连）",
  institutionalEnabledHint: "需要您自己的订阅访问权限（校园网/VPN）。",
  scihubMirrors: "Sci-Hub 镜像覆盖",
  scihubMirrorsHint: "逗号分隔的主机名；留空使用内置列表。",
  pdfOutputDir: "PDF 输出目录",
  pdfOutputDirHint: "相对路径基于当前会话工作区解析。",
  maxResultsPerSearch: "默认搜索结果数",
  maxResultsPerSearchHint: "scholar_search_* 工具的默认结果上限（最大 1000）。",
  fetchTimeoutSec: "HTTP 超时（秒）",
  fetchTimeoutSecHint: "搜索与下载的单个请求超时。",
  maxPdfSizeMb: "PDF 大小上限（MB）",
  maxPdfSizeMbHint: "超过该大小的响应会被拒绝。",
  s2RequestGapMs: "S2 请求间隔覆盖（毫秒）",
  s2RequestGapMsHint: "0 = 自动（有密钥 1100 毫秒，匿名 5000 毫秒）。"
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
