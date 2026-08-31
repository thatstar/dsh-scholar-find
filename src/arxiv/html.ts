/**
 * arXiv official HTML full text — the backing of the `arxiv_get_fulltext` tool.
 *
 * arXiv publishes an official HTML rendering of most papers at
 * `https://arxiv.org/html/<arxiv_id>` (launched 2023-12; documented at
 * https://info.arxiv.org/about/accessible_HTML.html). The conversion is
 * LaTeXML-based, labelled "experimental", and only a subset of the corpus is
 * backfilled — a paper without an HTML version returns HTTP 404 (the tool then
 * reports `available: false`; the PDF route via `paper_fetch_*` still works).
 *
 * Pipeline: normalise the id → fetch the page (proxied, timeout-bounded,
 * cancellable) → parse with parse5 → convert to a tiny plain DOM → render
 * Markdown full text (default) or the article-scoped raw HTML. Degradation is
 * deliberate: unknown elements fall back to their text, math uses the
 * LaTeXML `alttext` (LaTeX source) first, then the `<annotation>` tex, then
 * the inner text; if no `<article>` is found the renderer walks
 * `div.ltx_page_content`, then the whole body — the tool never fails on a
 * markup surprise, it degrades.
 * @module dsh-scholar-find/arxiv
 */

import { parse } from 'parse5'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { timedFetch } from '../fetch/transport.js'
import { resolveRootDir, resolveSubDir } from '../outdir.js'

/** Base of the official arXiv HTML service. */
export const ARXIV_HTML_BASE = 'https://arxiv.org/html'

/** Element tags that carry no readable content (chrome / UI / embeds). */
const CHROME_TAGS = new Set([
  'script', 'style', 'nav', 'header', 'footer', 'button', 'form', 'input',
  'select', 'option', 'textarea', 'noscript', 'iframe', 'template', 'svg',
])

/** Class markers whose whole subtree is dropped from the rendered output.
 * Frontmatter notes (author thanks/dedications) and affiliation footnotemark
 * markers are boilerplate; note marks (†), type labels ("thanks: ") and the
 * in-note number tags are conversion chrome — body footnotes (`ltx_role_footnote`)
 * are collected and rendered as real Markdown footnotes instead. */
const DROP_CLASS_MARKERS = [
  'ltx_author_notes',
  'ltx_tag_note',
  'ltx_role_refnote',
  'ltx_note_frontmatter',
  'ltx_note_mark',
  'ltx_note_type',
  'ltx_role_footnotemark',
]

/** Thrown when the input is not a recognisable arXiv id / URL. */
export class ArxivInputError extends Error {}

// ---------------------------------------------------------------------------
// Tiny plain DOM (decoupled from parse5 so the renderers are pure and the
// fixtures in tests need no parser).
// ---------------------------------------------------------------------------

/** A plain element node. */
export interface ArxivElement {
  tag: string
  attrs: Record<string, string>
  children: ArxivNode[]
}

/** A plain text node (whitespace-trimmed at conversion time). */
export type ArxivText = { text: string }

export type ArxivNode = ArxivElement | ArxivText

/** The parsed page: the content root plus the document title. */
export interface ArxivPage {
  article: ArxivElement
  title: string
}

function isElement(node: ArxivNode): node is ArxivElement {
  return 'tag' in node
}

/** Text content of a node subtree (for fallbacks and titles). */
export function textContent(node: ArxivNode): string {
  if (!isElement(node)) return node.text
  let out = ''
  for (const c of node.children) out += textContent(c)
  return out
}

function convertParse5(node: any): ArxivNode[] {
  const nodes: ArxivNode[] = []
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === '#text') {
      const v = child.value ?? ''
      if (v.trim()) {
        nodes.push({ text: v })
      } else if (v && !v.includes('\n')) {
        // Single-line whitespace runs are inline separators (e.g. the spaces
        // between author names) — keep them; block-level newlines are dropped.
        nodes.push({ text: v })
      }
      continue
    }
    if (child.nodeName === '#comment' || child.nodeName === '#documentType') continue
    const attrs: Record<string, string> = {}
    for (const a of child.attrs ?? []) attrs[a.name] = String(a.value ?? '')
    nodes.push({ tag: child.tagName, attrs, children: convertParse5(child) })
  }
  return nodes
}

function findElement(nodes: ArxivNode[], tag: string, classMarker?: string): ArxivElement | null {
  for (const n of nodes) {
    if (isElement(n)) {
      const cls = n.attrs.class ?? ''
      if (n.tag === tag && (!classMarker || cls.includes(classMarker))) return n
      const hit = findElement(n.children, tag, classMarker)
      if (hit) return hit
    }
  }
  return null
}

function findHeading(nodes: ArxivNode[]): ArxivElement | null {
  for (const n of nodes) {
    if (isElement(n)) {
      const cls = n.attrs.class ?? ''
      if (/^h[1-6]$/.test(n.tag) && cls.includes('ltx_title_document')) return n
      const hit = findHeading(n.children)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Parse an arXiv HTML page into the plain DOM. The content root is the
 * `<article class="ltx_document">`; degradation falls back to
 * `div.ltx_page_content`, then to the whole `body`.
 */
export function parseArxivPage(html: string): ArxivPage {
  const doc = parse(html)
  const nodes = convertParse5(doc)
  const article =
    findElement(nodes, 'article', 'ltx_document') ??
    findElement(nodes, 'div', 'ltx_page_content') ??
    findElement(nodes, 'body') ??
    { tag: 'div', attrs: {}, children: nodes }
  const heading = findHeading(article.children)
  const title = heading ? textContent(heading).replace(/\s+/g, ' ').trim() : ''
  return { article, title }
}

/**
 * The resolved version suffix from the page's own header line
 * (`arXiv:2402.08954v1 [cs.DL] …`), when the page carries one.
 */
export function pageVersion(html: string): string | undefined {
  const m = /arXiv:\s*([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?|[a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v[0-9]+)?)/i.exec(html)
  return m?.[1]
}

// ---------------------------------------------------------------------------
// Id normalisation
// ---------------------------------------------------------------------------

/** arXiv id patterns: new style (`2402.08954`), old style (`hep-ex/0307015`,
 * `math.GT/0501001`), each with an optional `vN` version suffix. */
const ARXIV_ID_RE = /^([a-z-]+(?:\.[A-Z]{2})?\/\d{7}|[0-9]{4}\.[0-9]{4,5})(v\d+)?$/i

/**
 * Normalise a user-supplied arXiv id or abs/pdf/html URL to a canonical id
 * (version suffix preserved when given). Throws {@link ArxivInputError} for
 * anything unrecognisable.
 */
export function normalizeArxivId(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) throw new ArxivInputError('empty arXiv id')
  let id = raw
  const url = /arxiv\.org\/(?:abs|pdf|html)\/([^?#]+)/i.exec(raw)
  if (url) id = url[1]!.replace(/\/+$/, '')
  id = id.replace(/^arXiv\s*:/i, '').trim()
  const m = ARXIV_ID_RE.exec(id)
  if (!m) throw new ArxivInputError(`"${input}" is not a valid arXiv id`)
  return `${m[1]}${m[2] ?? ''}`
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** The fetched page: HTTP status plus the raw HTML body. */
export interface ArxivFetchResult {
  status: number
  html: string
}

/**
 * GET the official HTML page for an arXiv id. Throws on transport errors
 * (timeout / DNS / abort); the caller inspects `status` (404 = no HTML
 * version for this paper).
 */
export async function fetchArxivHtml(arxivId: string, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<ArxivFetchResult> {
  // arXiv ids are validated to [a-z0-9./-] — safe to interpolate verbatim
  // (percent-encoding would break the old-style `xxx/1234567` path segment).
  const res = await timedFetch(`${ARXIV_HTML_BASE}/${arxivId}`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  }, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
    errorLabel: `arxiv html timeout after ${opts.timeoutMs}ms`,
  })
  return { status: res.status, html: await res.text() }
}

// ---------------------------------------------------------------------------
// Rendering: Markdown (default) and article-scoped HTML
// ---------------------------------------------------------------------------

function mathMarkdown(node: ArxivElement): string {
  const alt = (node.attrs.alttext ?? '').trim()
  const tex = alt || annotationTex(node) || textContent(node).trim()
  const display = node.attrs.display === 'block' || (node.attrs.class ?? '').includes('ltx_DisplayMath')
  return display ? `\n$$\n${tex}\n$$\n` : `$${tex}$`
}

function annotationTex(node: ArxivElement): string {
  for (const c of node.children) {
    if (isElement(c) && c.tag === 'annotation') return textContent(c).trim()
  }
  return ''
}

/** Markdown image with the src resolved to an absolute arXiv URL. */
export function imageMarkdown(node: ArxivElement): string {
  const src = node.attrs.src ?? ''
  if (!src) return ''
  const url = /^https?:/i.test(src) ? src : `${ARXIV_HTML_BASE}/${src.replace(/^\.?\//, '')}`
  const alt = node.attrs.alt && node.attrs.alt !== 'Refer to caption' ? node.attrs.alt : ''
  return `![${alt}](${url})`
}

/** Per-render state: body footnotes collected while walking the article. */
interface MarkdownCtx {
  footnotes: Array<{ n: number; text: string }>
}

/** Inline rendering: text, `$…$` math, images, `[^n]` footnotes; everything
 * else recurses. */
function renderInline(node: ArxivNode, ctx: MarkdownCtx): string {
  if (!isElement(node)) return node.text
  if (CHROME_TAGS.has(node.tag)) return ''
  if (dropClass(node)) return ''
  if (node.tag === 'math') return mathMarkdown(node)
  if (node.tag === 'img') return imageMarkdown(node)
  if (node.tag === 'br') return '\n'
  // Body footnote: LaTeXML carries the footnote text inline in the flow —
  // collect it and emit a Markdown footnote reference instead.
  if ((node.attrs.class ?? '').includes('ltx_role_footnote')) {
    const text = squeeze(renderInline({ tag: 'span', attrs: {}, children: node.children }, ctx))
    if (!text) return ''
    const n = ctx.footnotes.length + 1
    ctx.footnotes.push({ n, text })
    return `[^${n}]`
  }
  let out = ''
  for (const c of node.children) out += renderInline(c, ctx)
  return out
}

function dropClass(node: ArxivElement): boolean {
  const cls = node.attrs.class ?? ''
  return DROP_CLASS_MARKERS.some((m) => cls.includes(m))
}

/** Collapse horizontal whitespace runs (keeps `\n` so block math survives). */
function squeeze(s: string): string {
  return s.replace(/[ \t]+/g, ' ').trim()
}

function renderList(node: ArxivElement, ctx: MarkdownCtx): string {
  let out = ''
  for (const c of node.children) {
    if (!isElement(c)) continue
    if (c.tag === 'li') {
      const body = squeeze(renderInline(c, ctx)).replace(/^[•·]\s*/, '')
      if (body) out += `- ${body}\n`
    } else {
      out += renderBlock(c, ctx)
    }
  }
  return out
}

/** Figures and tables: LaTeXML wraps BOTH in `<figure class="ltx_figure">`
 * and `<figure class="ltx_table">`. Images render as markdown images; a
 * table-figure (or a figure containing a table) renders the table body. */
function renderFigure(node: ArxivElement, ctx: MarkdownCtx): string {
  let img = ''
  let table: ArxivElement | null = null
  const stack = [...node.children]
  while (stack.length && !img && !table) {
    const n = stack.shift()!
    if (isElement(n)) {
      if (n.tag === 'img') img = imageMarkdown(n)
      else if (n.tag === 'table' && !(n.attrs.class ?? '').includes('ltx_equation')) table = n
      else stack.push(...n.children)
    }
  }
  let cap = ''
  for (const c of node.children) {
    if (isElement(c) && c.tag === 'figcaption') cap = squeeze(renderInline(c, ctx))
  }
  const body = img ? `${img}\n\n` : table ? renderTable(table, ctx) : ''
  return `${body}*${cap}*\n\n`
}

/** Markdown table; skipped when the table has no rows or only empty cells. */
function renderTable(node: ArxivElement, ctx: MarkdownCtx): string {
  const rows: string[][] = []
  const collect = (list: ArxivNode[]) => {
    for (const n of list) {
      if (!isElement(n)) continue
      if (n.tag === 'tr') {
        const cells: string[] = []
        for (const td of n.children) {
          if (isElement(td) && (td.tag === 'td' || td.tag === 'th')) cells.push(squeeze(renderInline(td, ctx)))
        }
        rows.push(cells)
      } else {
        collect(n.children)
      }
    }
  }
  collect(node.children)
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  if (rows.every((r) => r.every((cell) => !cell))) return ''
  let out = ''
  rows.forEach((r, i) => {
    out += `| ${Array.from({ length: width }, (_, j) => r[j] ?? '').join(' | ')} |\n`
    if (i === 0) out += `| ${Array.from({ length: width }, () => '---').join(' | ')} |\n`
  })
  return `${out}\n`
}

/**
 * LaTeXML renders equations as `<table class="ltx_equation…">` wrappers and
 * splits long equations across several `<math>` elements — join all the math
 * pieces into ONE display block (plus the equation number tag), not tables.
 */
function renderEquationTable(node: ArxivElement, ctx: MarkdownCtx): string {
  const pieces: string[] = []
  const tags: string[] = []
  const stack = [...node.children]
  while (stack.length) {
    const n = stack.shift()!
    if (!isElement(n)) continue
    const cls = n.attrs.class ?? ''
    if (n.tag === 'math') {
      const tex = (n.attrs.alttext ?? '').trim() || annotationTex(n) || textContent(n).trim()
      if (tex) pieces.push(tex)
    } else if (cls.includes('ltx_tag')) {
      const t = squeeze(renderInline(n, ctx))
      if (t) tags.push(t)
    } else {
      stack.push(...n.children)
    }
  }
  if (!pieces.length) return ''
  return `$$\n${pieces.join('  ')}${tags.length ? `  ${tags.join(' ')}` : ''}\n$$\n\n`
}

/** Block-level rendering; unknown/container elements recurse generically. */
function renderBlock(node: ArxivNode, ctx: MarkdownCtx): string {
  if (!isElement(node)) return node.text
  if (CHROME_TAGS.has(node.tag)) return ''
  if (dropClass(node)) return ''
  const cls = node.attrs.class ?? ''
  const tag = node.tag

  if (/^h[1-6]$/.test(tag) && cls.includes('ltx_title')) {
    const level = Math.min(6, Math.max(1, parseInt(tag.slice(1), 10)))
    const body = squeeze(renderInline(node, ctx))
    return body ? `${'#'.repeat(level)} ${body}\n` : ''
  }
  if (tag === 'p' && !cls.includes('ltx_title')) {
    const body = squeeze(renderInline(node, ctx))
    return body ? `${body}\n\n` : ''
  }
  if (tag === 'ul' || tag === 'ol' || tag === 'dl') return renderList(node, ctx)
  if (tag === 'figure') return renderFigure(node, ctx)
  if (tag === 'table') {
    return cls.includes('ltx_equation') ? renderEquationTable(node, ctx) : renderTable(node, ctx)
  }
  if (tag === 'blockquote') {
    const body = squeeze(renderInline(node, ctx))
    return body ? `> ${body}\n\n` : ''
  }
  if (tag === 'math') return mathMarkdown(node)
  let out = ''
  for (const c of node.children) out += renderBlock(c, ctx)
  // Block containers (div/section/…) must terminate their text with a line
  // break so the next sibling block does not glue onto it ("Alice## 0.1").
  if (out && !out.endsWith('\n') && (tag === 'div' || tag === 'section' || tag === 'main' || tag === 'aside')) out += '\n'
  return out
}

/**
 * Render the article as Markdown full text: headings, paragraphs, lists,
 * figures (absolute image URLs), tables (incl. table-figures), inline `$…$`
 * and display `$$…$$` math from the LaTeXML `alttext`, `[^n]` footnotes with
 * a Footnotes section, references kept as plain list items.
 */
export function articleToMarkdown(article: ArxivElement): string {
  const ctx: MarkdownCtx = { footnotes: [] }
  let out = ''
  for (const c of article.children) out += renderBlock(c, ctx)
  if (ctx.footnotes.length) {
    out += `\n## Footnotes\n\n${ctx.footnotes.map((f) => `[^${f.n}]: ${f.text}`).join('\n\n')}\n`
  }
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Serialize the article back to HTML — "article-scoped raw": the page chrome
 * (site header/nav/footer/modals/scripts) is dropped, the content subtree is
 * kept verbatim (attributes included).
 */
export function articleToHtml(article: ArxivElement): string {
  const serialize = (node: ArxivNode): string => {
    if (!isElement(node)) return escapeHtml(node.text)
    if (CHROME_TAGS.has(node.tag)) return ''
    const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('')
    const inner = node.children.map(serialize).join('')
    return `<${node.tag}${attrs}>${inner}</${node.tag}>`
  }
  return serialize(article)
}

// ---------------------------------------------------------------------------
// One-shot orchestration (used by the tool)
// ---------------------------------------------------------------------------

export type ArxivFulltextFormat = 'markdown' | 'html'

export interface ArxivFulltextInput {
  /** The arXiv id / URL as supplied by the caller. */
  arxivId: string
  /** Persist under the library dirs (`md/` or `html/`); false → inline content. */
  save: boolean
  /** `true` → Markdown; `false` → article-scoped raw HTML. */
  md: boolean
  /** Optional inline truncation cap (characters); no cap when absent. */
  maxChars?: number
  timeoutMs: number
  signal?: AbortSignal
  /** Session workspace base (for resolving `defaultOutputDir`). */
  baseDir: string
  defaultOutputDir: string
}

export type ArxivFulltextResult =
  | { ok: true; available: false; arxivId: string; markdown: string }
  | {
      ok: true
      available: true
      arxivId: string
      version: string
      title: string
      format: ArxivFulltextFormat
      chars: number
      path?: string
      content?: string
      truncated?: boolean
      markdown: string
    }
  | { ok: false; code: string; retryable: boolean; message: string; markdown: string }

/** Filename-safe form of an arXiv id (old-style ids contain a slash). */
export function arxivFileName(arxivId: string, format: ArxivFulltextFormat): string {
  const base = arxivId.replace(/[^A-Za-z0-9._-]+/g, '_')
  return `${base}.${format === 'markdown' ? 'md' : 'html'}`
}

/**
 * The full `arxiv_get_fulltext` pipeline: normalise → fetch → map the HTTP
 * status → parse → render → save (or inline). Never throws for expected
 * conditions (404, transport, bad input) — those become result envelopes.
 */
export async function arxivGetFulltext(input: ArxivFulltextInput): Promise<ArxivFulltextResult> {
  let arxivId: string
  try {
    arxivId = normalizeArxivId(input.arxivId)
  } catch (e) {
    const message = e instanceof ArxivInputError ? e.message : String(e)
    return {
      ok: false,
      code: 'validation_error',
      retryable: false,
      message,
      markdown: `arxiv_get_fulltext: ${message}. Use e.g. \`2402.08954\`, \`2402.08954v2\`, \`hep-ex/0307015\` or an abs/pdf/html URL.`,
    }
  }

  let fetched: ArxivFetchResult
  try {
    fetched = await fetchArxivHtml(arxivId, { timeoutMs: input.timeoutMs, signal: input.signal })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      code: 'network_error',
      retryable: true,
      message,
      markdown: `arxiv_get_fulltext: network error fetching \`https://arxiv.org/html/${arxivId}\` — ${message}. Retry later (transient).`,
    }
  }

  if (fetched.status === 404) {
    return {
      ok: true,
      available: false,
      arxivId,
      markdown: `No official HTML version for arXiv:${arxivId}. arXiv only publishes HTML for a subset of papers (conversion is LaTeXML-based and gradual). Try \`paper_fetch_download\` (PDF) or \`scholar_get_paper_snippets\` (full-text snippets) instead.`,
    }
  }
  if (fetched.status !== 200) {
    const message = `arxiv html returned HTTP ${fetched.status}`
    return {
      ok: false,
      code: 'http_error',
      retryable: fetched.status >= 500,
      message,
      markdown: `arxiv_get_fulltext: ${message} for \`${arxivId}\`.`,
    }
  }

  const page = parseArxivPage(fetched.html)
  const format: ArxivFulltextFormat = input.md ? 'markdown' : 'html'
  const content = format === 'markdown' ? articleToMarkdown(page.article) : articleToHtml(page.article)
  const version = pageVersion(fetched.html) ?? arxivId
  const head = `**arXiv:${arxivId}**${version && version !== arxivId ? ` (resolved ${version})` : ''}${page.title ? ` — ${page.title}` : ''}\n**Format:** ${format} · **${content.length.toLocaleString()} chars**`

  if (input.save) {
    const root = resolveRootDir(input.defaultOutputDir, input.baseDir)
    const sub = format === 'markdown' ? 'md' : 'html'
    const dir = resolveSubDir(root, sub)
    const path = join(dir, arxivFileName(arxivId, format))
    await mkdir(dir, { recursive: true })
    await writeFile(path, content, 'utf8')
    return {
      ok: true,
      available: true,
      arxivId,
      version,
      title: page.title,
      format,
      chars: content.length,
      path,
      markdown: `${head}\n**Saved:** \`${path}\``,
    }
  }

  let out = content
  let truncated = false
  const cap = input.maxChars
  if (cap !== undefined && out.length > cap) {
    out = out.slice(0, cap)
    truncated = true
  }
  return {
    ok: true,
    available: true,
    arxivId,
    version,
    title: page.title,
    format,
    chars: content.length,
    content: out,
    truncated,
    markdown: `${head}\n${truncated ? `**Truncated to ${cap} chars (inline); full length ${content.length}.**\n\n` : '\n'}\`\`\`\n${out.slice(0, 600)}${out.length > 600 ? '…' : ''}\n\`\`\``,
  }
}
