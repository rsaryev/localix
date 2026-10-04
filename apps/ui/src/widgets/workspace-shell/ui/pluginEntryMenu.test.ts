import { describe, expect, test } from 'bun:test'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { pluginEntryMenuEntries } from './pluginEntryMenu'
import type { RailEntry } from './shellTypes'

const entry = (overrides: Partial<RailEntry> = {}): RailEntry => ({
  id: 'view:sample',
  label: 'Sample',
  icon: null,
  active: false,
  onClick: () => {},
  plugin: true,
  pluginName: 'sample',
  resourceUri: 'localix://ui/plugin/sample',
  ...overrides,
})

const ids = (entries: MenuEntry[]) => entries.map((item) => ('id' in item ? item.id : '—'))
const select = (entries: MenuEntry[], id: string) => {
  const item = entries.find((candidate) => 'id' in candidate && candidate.id === id)
  if (!item || !('onSelect' in item)) throw new Error(`no action ${id}`)
  item.onSelect()
}

describe('pluginEntryMenuEntries', () => {
  test('offers every action the entry can honour', () => {
    const menu = pluginEntryMenuEntries(entry(), {
      settingsUri: (name) => `settings:${name}`,
      onNavigateUi: () => {},
      isRecent: true,
      onRemoveRecent: () => {},
      copyText: () => {},
    })
    expect(ids(menu)).toEqual(['open', 'settings', 'remove-recent', '—', 'copy-link', 'copy-name'])
  })

  test('leaves out what the entry cannot honour instead of disabling it', () => {
    const menu = pluginEntryMenuEntries(entry({ pluginName: undefined, resourceUri: undefined }), {
      copyText: () => {},
    })
    expect(ids(menu)).toEqual(['open', '—'])
  })

  test('each action reaches its host operation', () => {
    const calls: string[] = []
    const menu = pluginEntryMenuEntries(entry({ onClick: () => calls.push('open') }), {
      settingsUri: (name) => `settings:${name}`,
      onNavigateUi: (uri) => calls.push(`nav ${uri}`),
      isRecent: true,
      onRemoveRecent: (id) => calls.push(`remove ${id}`),
      copyText: (text, label) => calls.push(`copy ${label}: ${text}`),
    })
    for (const id of ['open', 'settings', 'remove-recent', 'copy-link', 'copy-name'])
      select(menu, id)
    expect(calls).toEqual([
      'open',
      'nav settings:sample',
      'remove view:sample',
      'copy Plugin link: localix://ui/plugin/sample',
      'copy Plugin name: sample',
    ])
  })

  test('uninstall sits last, apart, and is disabled for a built-in plugin', () => {
    const removed: string[] = []
    const ops = {
      copyText: () => {},
      onUninstall: (name: string) => removed.push(name),
    }
    const menu = pluginEntryMenuEntries(entry(), { ...ops, canUninstall: () => true })
    expect(ids(menu).slice(-2)).toEqual(['—', 'uninstall'])
    select(menu, 'uninstall')
    expect(removed).toEqual(['sample'])

    const builtIn = pluginEntryMenuEntries(entry(), { ...ops, canUninstall: () => false })
    const row = builtIn.at(-1)
    expect(row && 'disabled' in row && row.disabled).toBe(true)
  })

  test('no uninstall row without a host that can remove plugins', () => {
    expect(ids(pluginEntryMenuEntries(entry(), { copyText: () => {} }))).not.toContain('uninstall')
  })
})
