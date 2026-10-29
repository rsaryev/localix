import { expect, test } from 'bun:test'
import { groupRailTools, isRailTool } from './railToolGroups'
import type { RailEntry } from '../ui/shellTypes'

test('manifest categories have stable order, skip empty groups and retain unknown mini apps', () => {
  const entries = ['Game', 'Records', 'Custom', 'Sync'].map(
    (id) => ({ id, miniAppName: id }) as RailEntry,
  )
  const groups = groupRailTools(
    entries,
    new Map([
      ['Game', 'games'],
      ['Records', 'data'],
      ['Sync', 'development'],
    ]),
  )
  expect(groups.map((group) => [group.label, group.entries.map((entry) => entry.id)])).toEqual([
    ['Workspace', ['Records', 'Sync']],
    ['Tools', ['Custom']],
    ['Games', ['Game']],
  ])
  expect(groupRailTools([])).toEqual([])
})

test('core catalog tools join utilities without pretending to be mini apps', () => {
  const usage = { id: 'usage', toolCategory: 'utilities' } as RailEntry
  const vault = { id: 'vault', toolCategory: 'utilities' } as RailEntry
  expect(isRailTool(usage)).toBe(true)
  expect(isRailTool({ id: 'settings' } as RailEntry)).toBe(false)
  const groups = groupRailTools([usage, vault])
  expect(groups.map((group) => group.label)).toEqual(['Tools'])
  expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['usage', 'vault'])
})
