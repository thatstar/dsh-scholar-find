/**
 * scholar-citation-style skill: the citation/bibliography contract for any
 * report the scholar tools feed. Findings 1/2/3/11 of the real-world report
 * came from leaving bibliography layout to be re-derived per task (a 48-entry
 * list rendered as one paragraph, footnote numbers disagreeing with their
 * markers, 13 back-references on one entry, a hand-invented marker form).
 *
 * The rules are not stylistic preference: they match what the DSH Markdown
 * renderer actually does (verified in
 * packages/client/ui-primitives/src/markdown/render.tsx): a footnote's number is
 * its first-reference position (the digit in the definition is ignored),
 * back-references are emitted once per rendered citation, and a definition that
 * is never referenced is dropped entirely.
 */

export const SCHOLAR_CITATION_STYLE_SKILL = {
  name: 'scholar-citation-style',
  description:
    'Citation and bibliography contract for scholar reports: footnote markers, definition layout and numbering, target style (GB/T 7714-2015 / APA / IEEE / Nature / BibTeX) and Chinese-report punctuation. Load before writing a report with a reference list.',
  whenToUse: 'A report, review, or answer needs a reference list, footnotes, or a declared citation style.',
  source: 'runtime',
  content: `# Scholar workflow: citation & bibliography contract

Applies to every report, review or answer that cites sources. Decide the layout
ONCE, here, instead of re-deriving it per task. The reference DATA comes from
\`scholar_export_bibtex\`, \`scholar_format_references\` (when available) or the
metadata returned by \`scholar_get_paper\`; this skill governs how it is emitted.

## Why these rules (the renderer's actual behaviour)

- a footnote's number is its **first-reference position**; the digit written in
  the definition is ignored;
- **one back-reference is emitted per rendered citation**, so a source cited 13
  times gets \`↩ ↩2 … ↩13\` on one entry;
- a definition that is **never referenced is dropped** from the section.

The conventions below are the ones that survive that renderer.

## Rules (follow exactly)

1. **Declare the style first.** State the target style at the top of the report
   (\`引用格式 / Citation style: GB/T 7714-2015\`), then keep every entry in it.
   Never mix styles.
2. **Marker at first mention only.** Use \`[^n]\` at the FIRST citation of a
   source; afterwards refer to it in prose (author–year, e.g. \`Zhang 等 (2021)\`).
   This yields exactly one back-reference per source.
3. **Definitions at the end, blank-line separated.** Every definition is
   \`[^n]: <full entry>\` and definitions are separated by a **blank line** —
   consecutive non-blank lines merge into one paragraph in CommonMark, which is
   how a 48-entry list becomes a wall of text.
4. **Number by first reference.** \`n\` is the order in which the source is first
   cited (1, 2, 3, …), never a topic grouping. If an existing draft numbers by
   topic, renumber markers, definitions and cross-references in ONE pass.
5. **Every definition must be referenced.** An unreferenced definition is
   dropped by the renderer; delete it or cite it.
6. **No markers in appendix/summary tables.** Restating \`[^n]\` in a table
   doubles every back-reference count. Refer to sources by author–year there.
7. **Never invent a marker form.** \`（文献 [13]）\` is neither a footnote nor a
   numbered style: it collides with the reference list's own \`[N]\` labels. Use
   \`[^13]\` (or plain author–year prose), attached to the sentence.

## Entry templates

Given authors, title, venue, year, volume/issue, pages, DOI:

- **GB/T 7714-2015** (Chinese reports; use with footnote markers):
  - journal: \`作者. 题名[J]. 刊名, 年, 卷(期): 起止页码.\`
  - book: \`作者. 书名[M]. 版本. 出版地: 出版者, 年: 页码.\`
  - conference: \`作者. 题名[C]//论文集名. 出版地: 出版者, 年: 页码.\`
  - thesis: \`作者. 题名[D]. 保存地: 保存单位, 年.\`
  - ≥4 authors: list the first 3 then \`等\` (Chinese) / \`et al.\` (English).
  - add \`DOI: …\` when the entry is online-first or has no volume/pages.
- **APA 7**: \`Author, A. A., & Author, B. B. (Year). Title. Venue, volume(issue), pages. https://doi.org/…\`
- **IEEE**: \`[n] A. A. Author and B. B. Author, "Title," Venue, vol. x, no. y, pp. z–z, Year.\`
- **Nature**: \`Author, A. A. et al. Title. Venue volume, pages (Year).\`
- **BibTeX**: use \`scholar_export_bibtex\` output verbatim.

## Chinese-report punctuation

- Chinese prose uses full-width punctuation (\`，。；：\`); the footnote marker is
  attached to the sentence, never wrapped in full-width parentheses.
- Do not put an ASCII superscript inside full-width parentheses — the exact
  first-pass error this contract removes.
- Keep digits and Latin terms in half-width; put a space between Chinese and
  Latin text where readability requires it.

## Output

The report body with \`[^n]\` markers in first-reference order, followed by a
\`## References / 参考文献\` section of blank-line-separated \`[^n]: <entry>\`
definitions in the declared style. No entry without a marker, no marker without
an entry, no renumbered leftovers.`,
}
