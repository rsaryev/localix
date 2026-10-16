import { expect, test } from 'bun:test'
import { SETTINGS_STRING_TABS } from '@/shared/routing/routes'
import { primarySettingsSection, SETTINGS_SECTIONS } from './settingsNavigation'
import { SETTINGS_INDEX } from './settingsIndex'
import { searchSettings } from './settingsSearch'

test('every settings destination has exactly one primary section', () => {
  const ids: string[] = SETTINGS_SECTIONS.map((section) => section.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const tab of SETTINGS_STRING_TABS) {
    expect(ids).toContain(primarySettingsSection(tab))
  }
  expect(primarySettingsSection({ kind: 'project', id: 'project-1' })).toBe('project')
  expect(primarySettingsSection('rules')).toBe('tools')
  expect(primarySettingsSection('agents')).toBe('agents')
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
  expect(SETTINGS_INDEX.find((entry) => entry.tab === 'agents')?.tabLabel).toBe('Agents')
})
