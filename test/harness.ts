/**
 * Tool-execution harness: a cordis-shaped fake context that runs the real
 * `apply()` wiring and captures the registered tool definitions, so a spec can
 * invoke a tool's `execute` exactly as the runtime would (including the
 * `sanitizeForOutput` wrapper registerTool applies) with `fetch` stubbed.
 *
 * Not a spec file itself — `.spec.ts` is the vitest collection pattern.
 */
import { apply } from '../src/index.js'
import { DEFAULT_SCHOLAR_SETTINGS, type ScholarSettings } from '../src/settings.js'
import { vi } from 'vitest'

/** A registered tool definition as captured from `ctx.tools.register`. */
export interface CapturedTool {
  name: string
  description: string
  parameters: { properties?: Record<string, { type?: string; enum?: string[] }> }
  output: { schema: Record<string, unknown>; render: (args: unknown, value: any) => unknown }
  execute: (args: any, exec: any) => Promise<any>
  timeoutMs?: number
}

export interface ScholarHarness {
  tools: CapturedTool[]
  byName: Map<string, CapturedTool>
  skills: Array<{ name: string; source: string; content: string }>
  sections: Array<{ name: string; order: number; text: string }>
  /**
   * The page policy the plugin registered with the settings service (undefined
   * when the fake profile serves no settings service at all).
   */
  settingsPolicy: { auto?: boolean } | undefined
  /** Patch the live settings the tools read through `env.settings()`. */
  setSettings(patch: Partial<ScholarSettings>): void
}

/**
 * Build a context, run `apply()`, and return the captured registrations.
 * `s2RequestGapMs` defaults to 1 ms so S2 calls in tests do not wait out the
 * 5 s anonymous pacing gap; tests can still override it.
 */
export function makeScholarContext(
  overrides: Partial<ScholarSettings> = {},
  opts: { web?: unknown; credentials?: unknown } = {},
): ScholarHarness {
  const tools: CapturedTool[] = []
  const skills: Array<{ name: string; source: string; content: string }> = []
  const sections: Array<{ name: string; order: number; text: string }> = []
  let settingsPolicy: { auto?: boolean } | undefined
  // The live config the plugin reads. Mutated in place (like the volatile
  // references the loader commits into) so `setSettings` is visible to the
  // plugin through the same read path a saved value takes.
  const current: ScholarSettings = { ...DEFAULT_SCHOLAR_SETTINGS, s2RequestGapMs: 1, ...overrides }

  /** The settings-service child `ctx.inject(['settings'], …)` hands the plugin. */
  const settingsChild = {
    settings: {
      configure: (presentation: { auto?: boolean }) => {
        settingsPolicy = presentation
        return () => {}
      },
    },
    effect: <T>(callback: () => T): T => callback(),
  }
  const ctx = {
    get(name: string): unknown {
      if (name === 'tools') return { register: (t: CapturedTool) => { tools.push(t); return () => {} } }
      if (name === 'skills') return { register: (s: { name: string; source: string; content: string }) => { skills.push(s); return () => {} } }
      if (name === 'systemPrompt') return { section: (s: { name: string; order: number; text: string }) => { sections.push(s) } }
      if (name === 'credentials') return opts.credentials
      if (name === 'web') return opts.web
      return undefined
    },
    on: () => () => {},
    inject: (_deps: string[], callback: (child: typeof settingsChild) => void) => { callback(settingsChild) },
    effect: <T>(callback: () => T): T => callback(),
    fiber: {},
  }

  apply(ctx as never, current)
  if (tools.length === 0) throw new Error('harness: apply() registered no tools')
  return {
    tools,
    byName: new Map(tools.map((t) => [t.name, t])),
    skills,
    sections,
    settingsPolicy,
    setSettings: (patch) => { Object.assign(current, patch) },
  }
}

/** A tool run context: only `agent.session.header.cwd` and `signal` are read. */
export function execFor(cwd = '/tmp/scholar-harness'): { signal?: AbortSignal; agent: { session: { header: { cwd: string } } } } {
  return { signal: undefined, agent: { session: { header: { cwd } } } }
}

/** Run one captured tool by name. */
export async function runTool(h: ScholarHarness, name: string, args: unknown, exec = execFor()): Promise<any> {
  const tool = h.byName.get(name)
  if (!tool) throw new Error(`harness: no tool named ${name}`)
  return tool.execute(args, exec)
}

/** JSON response for the stubbed global fetch. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * Stub the global fetch with a URL-routing handler. Returns the mock so a spec
 * can assert on calls. Unknown URLs resolve to a 404 JSON body (so an
 * unexpected call is visible rather than hanging).
 */
export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const mock = vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(String(url), init)))
  vi.stubGlobal('fetch', mock)
  return mock as unknown as ReturnType<typeof vi.fn>
}
