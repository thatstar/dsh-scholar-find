/**
 * Locale dictionaries for the dsh-scholar-find settings card (client half).
 * Registered under the `dsh-scholar-find` dictionary namespace.
 * @module dsh-scholar-find/client-locales
 */

export const NS = 'dsh-scholar-find'

/** Locale keys this card renders. */
export type ScholarLocaleKey =
  | 'title' | 'description'
  | 'save' | 'saving' | 'discard' | 'overridden' | 'reset'
  | 'unsaved' | 'expand' | 'collapse' | 'readOnly' | 'invalidNumber'
  | 'configured' | 'notConfigured'
  | 'unpaywallEmail' | 'unpaywallEmailHint'
  | 's2ApiKey' | 's2ApiKeyHint'
  | 'astaApiKey' | 'astaApiKeyHint'
  | 'sciverseApiKey' | 'sciverseApiKeyHint'
  | 'cloakEnabled' | 'cloakEnabledHint'
  | 'proxyUrl' | 'proxyUrlHint'
  | 'defaultOutputDir' | 'defaultOutputDirHint'
  | 'maxResultsPerSearch' | 'maxResultsPerSearchHint'
  | 'fetchTimeoutSec' | 'fetchTimeoutSecHint'
  | 'maxPdfSizeMb' | 'maxPdfSizeMbHint'
  | 's2RequestGapMs' | 's2RequestGapMsHint'

export const en: Record<ScholarLocaleKey, string> = {
  title: 'Scholar Retrieval',
  description: 'Semantic Scholar search and open-access PDF fetch.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  overridden: 'Overridden',
  reset: 'Reset',
  unsaved: 'Unsaved',
  expand: 'Show settings',
  collapse: 'Hide settings',
  readOnly: 'This deployment stores settings read-only.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  configured: 'Key set',
  notConfigured: 'No key set',
  unpaywallEmail: 'Unpaywall contact email',
  unpaywallEmailHint: 'Enables the Unpaywall source (also Crossref politeness). Empty means Unpaywall is skipped.',
  s2ApiKey: 'Semantic Scholar API key',
  s2ApiKeyHint: 'Stored in DSH key management. Enter a value to set or replace it.',
  astaApiKey: 'Ai2 Asta API key',
  astaApiKeyHint: 'Stored in DSH key management. Enter a value to set or replace it.',
  sciverseApiKey: 'Sciverse API token',
  sciverseApiKeyHint: 'Stored in DSH key management. Enter a value to set or replace it.',
  cloakEnabled: 'CloakBrowser fallback',
  cloakEnabledHint: 'Retry Cloudflare/WAF-blocked PDFs through a stealth browser (heavy). Off by default.',
  proxyUrl: 'Outbound HTTP proxy',
  proxyUrlHint: 'e.g. http://127.0.0.1:10808. Empty = off / fall back to HTTPS_PROXY.',
  defaultOutputDir: 'Default output directory',
  defaultOutputDirHint: 'Base folder for PDFs / Markdown / figures (default .scholar); relative paths resolve against the session workspace.',
  maxResultsPerSearch: 'Default results per search',
  maxResultsPerSearchHint: 'Result cap used by scholar_search_* tools (max 100).',
  fetchTimeoutSec: 'HTTP timeout (seconds)',
  fetchTimeoutSecHint: 'Per-request timeout for searches and downloads.',
  maxPdfSizeMb: 'PDF size cap (MB)',
  maxPdfSizeMbHint: 'Larger responses are rejected.',
  s2RequestGapMs: 'S2 pacing override (ms)',
  s2RequestGapMsHint: '0 = auto (1100 ms with key, 5000 ms anonymous).',
}

export const zh: Record<ScholarLocaleKey, string> = {
  title: '学术检索',
  description: 'Semantic Scholar 论文检索与开放获取 PDF 下载。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  overridden: '已覆盖',
  reset: '恢复默认',
  unsaved: '未保存',
  expand: '显示设置',
  collapse: '收起设置',
  readOnly: '当前部署以只读方式存储设置。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  configured: '已设置密钥',
  notConfigured: '未设置密钥',
  unpaywallEmail: 'Unpaywall 联系邮箱',
  unpaywallEmailHint: '启用 Unpaywall 来源（同时用作 Crossref 礼貌池邮箱）。留空则跳过 Unpaywall。',
  s2ApiKey: 'Semantic Scholar API 密钥',
  s2ApiKeyHint: '存储于 DSH 密钥管理。输入数值以设置或替换。',
  astaApiKey: 'Ai2 Asta API 密钥',
  astaApiKeyHint: '存储于 DSH 密钥管理。输入数值以设置或替换。',
  sciverseApiKey: 'Sciverse API Token',
  sciverseApiKeyHint: '存储于 DSH 密钥管理。输入数值以设置或替换。',
  cloakEnabled: 'CloakBrowser 兜底',
  cloakEnabledHint: '对被 Cloudflare/WAF 拦截的 PDF 用隐形浏览器重试（较重）。默认关闭。',
  proxyUrl: '出站 HTTP 代理',
  proxyUrlHint: '例如 http://127.0.0.1:10808。留空 = 关闭 / 回退到 HTTPS_PROXY。',
  defaultOutputDir: '默认输出目录',
  defaultOutputDirHint: 'PDF/图片/Markdown 的基础目录（默认 .scholar）；相对路径基于当前会话工作区解析。',
  maxResultsPerSearch: '默认搜索结果数',
  maxResultsPerSearchHint: 'scholar_search_* 工具的默认结果上限（最大 100）。',
  fetchTimeoutSec: 'HTTP 超时（秒）',
  fetchTimeoutSecHint: '搜索与下载的单个请求超时。',
  maxPdfSizeMb: 'PDF 大小上限（MB）',
  maxPdfSizeMbHint: '超过该大小的响应会被拒绝。',
  s2RequestGapMs: 'S2 请求间隔覆盖（毫秒）',
  s2RequestGapMsHint: '0 = 自动（有密钥 1100 毫秒，匿名 5000 毫秒）。',
}