/**
 * Host-wiring tests for `apply()` — the composition entry point. These cover
 * the two layers the pure-data tests cannot see:
 *  - the exact registration payload handed to `ctx.skills.register` (the
 *    `source` bucket required by DSH's `validateDefinition` — see .notes/62);
 *  - the `scholar_list_library` schema enum staying in sync with the output
 *    layout (the `cards/` subdir — see .notes/63).
 */
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'
import { SCHOLAR_INSTRUCTIONS } from '../src/instructions.js'
import { SCHOLAR_SKILLS } from '../src/skills/index.js'
import type { Context } from '@deepseek-ai/cordis'

/** Minimal skill registration accepted by ctx.skills.register (mirrors the plugin's ScholarSkillsService). */
interface SkillRegistration {
  name: string
  description: string
  whenToUse?: string
  source: string
  content: string
}

/** The JSON-Schema shape `defineTool` emits for a tool's parameters. */
interface ToolDefinition {
  name: string
  parameters: {
    properties?: Record<string, { type?: string; enum?: string[] }>
  }
}

interface PromptSection {
  name: string
  order: number
  text: string
}

/** A cordis-shaped fake that captures the services `apply()` reaches for. */
function makeContext() {
  const skillRegistrations: SkillRegistration[] = []
  const toolDefinitions: ToolDefinition[] = []
  const sections: PromptSection[] = []
  const ctx = {
    settings: {
      installSection: () => {},
    },
    get(name: string): unknown {
      if (name === 'skills') {
        return {
          register: (skill: SkillRegistration) => {
            skillRegistrations.push(skill)
            return () => {}
          },
        }
      }
      if (name === 'tools') {
        return {
          register: (tool: ToolDefinition) => {
            toolDefinitions.push(tool)
            return () => {}
          },
        }
      }
      if (name === 'systemPrompt') {
        return {
          section: (section: PromptSection) => {
            sections.push(section)
          },
        }
      }
      return undefined
    },
    effect: <T>(callback: () => T): T => callback(),
  }
  return { ctx: ctx as unknown as Context, skillRegistrations, toolDefinitions, sections }
}

describe('apply() host wiring', () => {
  it('forwards the source bucket on every skill registration (DSH validateDefinition contract)', () => {
    const { ctx, skillRegistrations } = makeContext()
    apply(ctx)
    expect(skillRegistrations).toHaveLength(SCHOLAR_SKILLS.length)
    expect(skillRegistrations.map((s) => s.name).sort()).toEqual(SCHOLAR_SKILLS.map((s) => s.name).sort())
    for (const registration of skillRegistrations) {
      expect(registration.source).toBe('runtime')
      expect(registration.description.length).toBeGreaterThan(0)
      expect(registration.whenToUse?.length ?? 0).toBeGreaterThan(0)
      expect(registration.content.length).toBeGreaterThan(0)
    }
  })

  it('mounts the resident instructions as the scholar-tools prompt section', () => {
    const { ctx, sections } = makeContext()
    apply(ctx)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe('scholar-tools')
    expect(sections[0]?.order).toBe(150)
    expect(sections[0]?.text).toBe(SCHOLAR_INSTRUCTIONS)
  })

  it('registers every one of the 27 tools through the tools service', () => {
    const { ctx, toolDefinitions } = makeContext()
    apply(ctx)
    expect(toolDefinitions).toHaveLength(27)
    const names = toolDefinitions.map((t) => t.name)
    for (const expected of ['scholar_search_papers', 'paper_pdf2md', 'scholar_list_library', 'arxiv_get_fulltext', 'sciverse_evidence_pack']) {
      expect(names).toContain(expected)
    }
  })

  it('keeps the scholar_list_library subdir enum in sync with the cards layout', () => {
    const { ctx, toolDefinitions } = makeContext()
    apply(ctx)
    const tool = toolDefinitions.find((t) => t.name === 'scholar_list_library')
    expect(tool).toBeDefined()
    const subdir = tool?.parameters.properties?.subdir
    expect(subdir?.enum).toEqual(['pdfs', 'md', 'html', 'figs', 'cards', 'all'])
  })
})
