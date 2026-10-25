import { describe, expect, it } from 'bun:test'
import { SETTINGS_INDEX } from '@/shared/lib/settings-index/settingsIndex'
import { parseSettingsQuery, searchSettings } from './settingsSearch'
import { KEYMAP_PRESETS } from '@/shared/lib/keybindings/presets'

describe('parseSettingsQuery', () => {
  it('splits free-text terms', () => {
    expect(parseSettingsQuery('font size')).toEqual({ terms: ['font', 'size'], tabFilters: [] })
  })
  it('extracts @tab: filter tokens', () => {
    expect(parseSettingsQuery('@tab:tools permission')).toEqual({
      terms: ['permission'],
      tabFilters: ['tools'],
    })
  })
  it('lowercases and trims', () => {
    expect(parseSettingsQuery('  FONT  ')).toEqual({ terms: ['font'], tabFilters: [] })
  })
})

describe('searchSettings', () => {
  it('finds the keymap selector by every supported editor name', () => {
    for (const preset of KEYMAP_PRESETS) {
      expect(searchSettings(SETTINGS_INDEX, preset.label).map((hit) => hit.entry.id)).toContain(
        'shortcuts.preset',
      )
    }
  })
  it('returns nothing for an empty query', () => {
    expect(searchSettings(SETTINGS_INDEX, '')).toEqual([])
    expect(searchSettings(SETTINGS_INDEX, '   ')).toEqual([])
  })

  it('finds a setting by title keyword', () => {
    const hits = searchSettings(SETTINGS_INDEX, 'font')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].entry.title.toLowerCase()).toContain('font')
    expect(hits.map((hit) => hit.entry.id)).toContain('prefs.code-font')
    expect(hits.map((hit) => hit.entry.id)).toContain('prefs.interface-font')
  })

  it('finds a setting by synonym keyword not present in the title', () => {
    const hits = searchSettings(SETTINGS_INDEX, 'autoformat')
    expect(hits.some((h) => h.entry.id === 'editor.format-on-save')).toBe(true)
  })

  it('ranks a title match above a description-only match', () => {
    const hits = searchSettings(SETTINGS_INDEX, 'model')
    // Resolved diagnostics has a title match; MCP servers mention models only in their description.
    const ids = hits.map((hit) => hit.entry.id)
    expect(ids.indexOf('diag.models')).toBeLessThan(ids.indexOf('cap.mcp'))
  })

  it('applies AND semantics across terms', () => {
    const both = searchSettings(SETTINGS_INDEX, 'tool bash')
    expect(both.some((h) => h.entry.id === 'cap.tools')).toBe(true)
    // A term that matches nothing drops the entry entirely.
    const none = searchSettings(SETTINGS_INDEX, 'permission zzzznope')
    expect(none).toEqual([])
  })

  /**
   * The two tabs answer different questions, and searching for one must not land on the
   * other: Tools says whether a capability may run at all, Permission rules says everything
   * else a rule can express — and it does so for every kind, not just tools.
   */
  it('sends a permission search to the rules tab', () => {
    const hits = searchSettings(SETTINGS_INDEX, 'permission')
    expect(hits.some((h) => h.entry.id === 'permissions.rules')).toBe(true)
    expect(hits.some((h) => h.entry.id === 'cap.tools')).toBe(false)
  })

  it('restricts results with a @tab: filter token', () => {
    const hits = searchSettings(SETTINGS_INDEX, '@tab:tools')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.entry.tab === 'tools')).toBe(true)
  })

  it('combines a @tab: filter with a term', () => {
    const hits = searchSettings(SETTINGS_INDEX, '@tab:preferences notification')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.entry.tab === 'preferences')).toBe(true)
    expect(hits.some((hit) => hit.entry.id === 'prefs.notifications')).toBe(true)
  })

  it('never matches across unrelated tabs for a specific term', () => {
    const hits = searchSettings(SETTINGS_INDEX, 'keybinding')
    expect(hits.every((h) => h.entry.tab === 'shortcuts')).toBe(true)
  })

  it('has a unique id per index entry', () => {
    const ids = SETTINGS_INDEX.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
