import { describe, expect, test } from 'bun:test'
import type { PaletteCommand } from '@/shared/contrib/uiCommands'
import { buildCommandPaletteSections } from './commandPaletteSections'

const noop = () => {}
const commands: PaletteCommand[] = [
  { id: 'new', label: 'New chat', group: 'Chat', effect: 'write', run: noop },
  { id: 'open', label: 'Open file', group: 'Navigation', effect: 'read', run: noop },
  {
    id: 'settings',
    label: 'Open settings',
    group: 'Navigation',
    effect: 'read',
    run: noop,
  },
  { id: 'theme', label: 'Change theme', group: 'Appearance', effect: 'read', run: noop },
]

describe('buildCommandPaletteSections', () => {
  test('promotes live MRU commands once and removes them from ordinary groups', () => {
    const sections = buildCommandPaletteSections(commands, ['open', 'stale', 'new', 'open'], '')

    expect(sections.recentCommands.map((command) => command.id)).toEqual(['open', 'new'])
    expect(
      sections.groups.map(([group, entries]) => [group, entries.map((command) => command.id)]),
    ).toEqual([
      ['Navigation', ['settings']],
      ['Appearance', ['theme']],
    ])
  })

  test('restores the complete declaration-ordered groups while searching', () => {
    const sections = buildCommandPaletteSections(commands, ['open', 'new'], ' open ')

    expect(sections.recentCommands).toEqual([])
    expect(
      sections.groups.map(([group, entries]) => [group, entries.map((command) => command.id)]),
    ).toEqual([
      ['Chat', ['new']],
      ['Navigation', ['open', 'settings']],
      ['Appearance', ['theme']],
    ])
  })
})
