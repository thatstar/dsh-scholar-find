/**
 * The scholar skills (variant C, split): one skill per workflow — each a
 * self-contained recipe + output contract, extensible independently (output
 * control lands in the skill's `## Output` section) — plus the scholar-tools
 * per-tool behavioral catalog. Pure data; registration lives in ../index.ts.
 * @module dsh-scholar-find/skills
 */

/** One registrable skill: pure data matching ctx.skills.register's input. */
export interface ScholarSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  /** Origin bucket required by the DSH skill contract (runtime registrations use 'runtime'). */
  readonly source: string
  readonly content: string
}

import { SCHOLAR_TOOLS_SKILL } from './scholar-tools.js'
import { SCHOLAR_LITERATURE_REVIEW_SKILL } from './literature-review.js'
import { SCHOLAR_SCIENTIFIC_RAG_SKILL } from './scientific-rag.js'
import { SCHOLAR_SYSTEMATIC_SCREEN_SKILL } from './systematic-screen.js'
import { SCHOLAR_EVIDENCE_PACK_SKILL } from './evidence-pack.js'
import { SCHOLAR_TREND_SCAN_SKILL } from './trend-scan.js'
import { SCHOLAR_MEMORY_SKILL } from './memory.js'

/** All skills this plugin contributes, in catalog order. */
export const SCHOLAR_SKILLS: ScholarSkill[] = [
  SCHOLAR_TOOLS_SKILL,
  SCHOLAR_LITERATURE_REVIEW_SKILL,
  SCHOLAR_SCIENTIFIC_RAG_SKILL,
  SCHOLAR_SYSTEMATIC_SCREEN_SKILL,
  SCHOLAR_EVIDENCE_PACK_SKILL,
  SCHOLAR_TREND_SCAN_SKILL,
  SCHOLAR_MEMORY_SKILL,
]
