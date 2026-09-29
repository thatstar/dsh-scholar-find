/**
 * Settings/Config tests: the plugin's Cordis `Config` schema is the settings
 * contract now (defaults, live-editability, and the bounds that refuse a bad
 * write), and `readScholarSettings` is the ONE place a value is read out of it.
 */
import { describe, expect, it } from 'vitest'
import {
  assertServiceableScholarSettings,
  DEFAULT_SCHOLAR_SETTINGS,
  readScholarSettings,
  ScholarConfigSchema,
  type ScholarConfigInput,
} from '../src/settings.js'

/**
 * One node of the serialized schema envelope. Schemastery serializes a schema
 * as a reference table (`{uid, refs}`), so a nested schema arrives as an index
 * into `refs` rather than inline.
 */
interface SchemaNodeJson {
  meta?: { volatile?: boolean; default?: unknown }
  dict?: Record<string, number>
}

interface SchemaJson {
  uid: number
  refs: Record<string, SchemaNodeJson>
}

describe('plugin Config schema', () => {
  it('declares exactly the settings fields, every one defaulted and live-editable', () => {
    const json = ScholarConfigSchema.toJSON() as unknown as SchemaJson
    const root = json.refs[String(json.uid)]
    const dict = root?.dict ?? {}
    const names = Object.keys(DEFAULT_SCHOLAR_SETTINGS).sort()
    expect(Object.keys(dict).sort()).toEqual(names)
    for (const name of names) {
      const field = json.refs[String(dict[name])]
      // Volatile is what makes a field editable in the Web UI's form; a field
      // without it would be invisible to the settings service.
      expect(field?.meta?.volatile, name).toBe(true)
      // A default keeps the plugin usable before the user touches the page.
      expect(field?.meta?.default, name).toEqual(DEFAULT_SCHOLAR_SETTINGS[name as keyof typeof DEFAULT_SCHOLAR_SETTINGS])
    }
  })

  it('parses an empty row into the schema defaults', () => {
    const parsed = ScholarConfigSchema({}) as unknown as ScholarConfigInput
    expect(readScholarSettings(parsed)).toEqual(DEFAULT_SCHOLAR_SETTINGS)
  })

  it('refuses values the tools could not run with (the write-time boundary)', () => {
    expect(() => ScholarConfigSchema({ maxResultsPerSearch: 101 })).toThrow()
    expect(() => ScholarConfigSchema({ maxResultsPerSearch: 0 })).toThrow()
    expect(() => ScholarConfigSchema({ fetchTimeoutSec: 0 })).toThrow()
    expect(() => ScholarConfigSchema({ maxPdfSizeMb: -1 })).toThrow()
    expect(() => ScholarConfigSchema({ s2RequestGapMs: -1 })).toThrow()
  })

  it('accepts the boundaries themselves', () => {
    expect(() => ScholarConfigSchema({ maxResultsPerSearch: 100, s2RequestGapMs: 0 })).not.toThrow()
  })
})

describe('readScholarSettings', () => {
  it('reads a parsed section through its live references', () => {
    const parsed = ScholarConfigSchema({ proxyUrl: 'http://127.0.0.1:10808', maxResultsPerSearch: 50 }) as unknown as ScholarConfigInput
    expect(readScholarSettings(parsed).proxyUrl).toBe('http://127.0.0.1:10808')
    expect(readScholarSettings(parsed).maxResultsPerSearch).toBe(50)
    // Untouched fields still answer with the schema default.
    expect(readScholarSettings(parsed).defaultOutputDir).toBe(DEFAULT_SCHOLAR_SETTINGS.defaultOutputDir)
  })

  it('tolerates a plain partial section (a host composing the row itself)', () => {
    expect(readScholarSettings({ maxResultsPerSearch: 5 })).toEqual({ ...DEFAULT_SCHOLAR_SETTINGS, maxResultsPerSearch: 5 })
    expect(readScholarSettings(undefined)).toEqual(DEFAULT_SCHOLAR_SETTINGS)
  })

  it('re-reads the section on every call, so a saved value reaches the next tool call', () => {
    const live: { proxyUrl: string } = { proxyUrl: '' }
    const source = () => readScholarSettings(live)
    expect(source().proxyUrl).toBe('')
    live.proxyUrl = 'http://127.0.0.1:10808'
    expect(source().proxyUrl).toBe('http://127.0.0.1:10808')
  })
})

describe('assertServiceableScholarSettings', () => {
  it('accepts the defaults', () => {
    expect(() => { assertServiceableScholarSettings(DEFAULT_SCHOLAR_SETTINGS) }).not.toThrow()
  })

  it('names the field it refuses', () => {
    expect(() => { assertServiceableScholarSettings({ ...DEFAULT_SCHOLAR_SETTINGS, fetchTimeoutSec: 0 }) }).toThrow(/fetchTimeoutSec/)
    expect(() => { assertServiceableScholarSettings({ ...DEFAULT_SCHOLAR_SETTINGS, maxResultsPerSearch: 101 }) }).toThrow(/maxResultsPerSearch/)
    expect(() => { assertServiceableScholarSettings({ ...DEFAULT_SCHOLAR_SETTINGS, s2RequestGapMs: -1 }) }).toThrow(/s2RequestGapMs/)
  })
})
