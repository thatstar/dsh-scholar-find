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
import { cleanCredentialValue } from '../src/refs.js'
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
  let settingsPolicy: { auto?: boolean } | undefined
  const listeners: string[] = []
  const ctx = {
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
    on: (event: string) => { listeners.push(event); return () => {} },
    inject: (_deps: string[], callback: (child: unknown) => void) => {
      callback({
        settings: {
          configure: (presentation: { auto?: boolean }) => {
            settingsPolicy = presentation
            return () => {}
          },
        },
        effect: <T>(inner: () => T): T => inner(),
      })
    },
    effect: <T>(callback: () => T): T => callback(),
    fiber: {},
  }
  return { ctx: ctx as unknown as Context, skillRegistrations, toolDefinitions, sections, listeners, policy: () => settingsPolicy }
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

  it('registers every one of the 28 tools through the tools service', () => {
    const { ctx, toolDefinitions } = makeContext()
    apply(ctx)
    expect(toolDefinitions).toHaveLength(28)
    const names = toolDefinitions.map((t) => t.name)
    for (const expected of ['scholar_search_papers', 'paper_pdf2md', 'scholar_list_library', 'arxiv_get_fulltext', 'sciverse_evidence_pack', 'scholar_format_references']) {
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

  it('declares its own settings page, so the service generates none (auto: false)', () => {
    const { ctx, policy } = makeContext()
    apply(ctx)
    expect(policy()).toEqual({ auto: false })
  })

  it('follows live config commits (the loader re-applies the proxy on volatile-update)', () => {
    const { ctx, listeners } = makeContext()
    apply(ctx)
    expect(listeners).toContain('loader/volatile-update')
  })
})

describe('cleanCredentialValue', () => {
  it('trims surrounding whitespace from a resolved credential value', () => {
    expect(cleanCredentialValue(' s2k-abc ')).toBe('s2k-abc')
    expect(cleanCredentialValue('\ts2k-abc\n')).toBe('s2k-abc')
  })

  it('degrades whitespace-only or missing values to undefined (fail-closed)', () => {
    expect(cleanCredentialValue('   ')).toBeUndefined()
    expect(cleanCredentialValue('')).toBeUndefined()
    expect(cleanCredentialValue(undefined)).toBeUndefined()
  })

  it('leaves already-clean values untouched', () => {
    expect(cleanCredentialValue('s2k-abc')).toBe('s2k-abc')
  })
})
