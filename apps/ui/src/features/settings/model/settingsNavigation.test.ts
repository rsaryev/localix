import { expect, test } from 'bun:test'
import { parseSettingsTab, SETTINGS_STRING_TABS } from '@/shared/routing/routes'
import { primarySettingsSection, SETTINGS_SECTIONS } from './settingsNavigation'
import { SETTINGS_INDEX } from '@/shared/lib/settings-index/settingsIndex'
import { searchSettings } from './settingsSearch'

test('every settings destination has exactly one primary section', () => {
  const ids: string[] = SETTINGS_SECTIONS.map((section) => section.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const tab of SETTINGS_STRING_TABS) {
    expect(ids).toContain(primarySettingsSection(tab))
  }
  expect(primarySettingsSection({ kind: 'project', id: 'project-1' })).toBe('project')
  expect(primarySettingsSection('permissions')).toBe('permissions')
  // Items (agents, skills, MCP servers, plugins, mini apps) are managed in the Store, not here.
  const layout: Record<string, string[]> = {}
  for (const section of SETTINGS_SECTIONS) (layout[section.group] ??= []).push(section.label)
  expect(layout).toEqual({
    Personal: ['Preferences', 'Editor', 'Shortcuts'],
    Workspace: ['Project'],
    Security: ['Permissions'],
    Application: ['Models', 'System'],
  })
})

test('no Settings page is left for an item the Store manages', () => {
  for (const moved of ['capabilities', 'mcp', 'agents', 'skills', 'plugins', 'mini-apps'])
    expect(parseSettingsTab(moved, undefined)).toBe('preferences')
})

test('every editor toggle can be found by its visible name', () => {
  for (const [title, id] of [
    ['Preview tabs', 'editor.preview-tabs'],
    ['Word wrap', 'editor.word-wrap'],
    ['Render whitespace', 'editor.render-whitespace'],
    ['Inlay hints', 'editor.inlay-hints'],
  ]) {
    expect(searchSettings(SETTINGS_INDEX, title!).map((result) => result.entry.id)).toContain(id!)
  }
})
