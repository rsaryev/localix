import { expect, test } from 'bun:test'

import { emptyLoadedMiniApps, type LoadedMiniApps } from './loader-contract'
import { narrowLoadedMiniApps } from './narrow'

const tool = (name: string) => ({ name }) as LoadedMiniApps['tools'][number]

function loaded(): LoadedMiniApps {
  return {
    ...emptyLoadedMiniApps(),
    tools: [tool('tiles_move'), tool('notes_add')],
    hooks: [
      { app: 'tiles', hooks: {}, ctx: {} },
      { app: 'notes', hooks: {}, ctx: {} },
    ] as unknown as LoadedMiniApps['hooks'],
    promptSections: [
      { app: 'tiles', title: 'Tiles', content: 'x' },
      { app: 'notes', title: 'Notes', content: 'y' },
    ],
    guides: [
      { app: 'tiles', file: '/apps/tiles/guide.md' },
      { app: 'notes', file: '/apps/notes/guide.md' },
    ],
    memory: { app: 'tiles', provider: {}, ctx: {} } as unknown as LoadedMiniApps['memory'],
    loaded: [
      { name: 'tiles', scope: 'global', description: '', toolNames: ['tiles_move'] },
      { name: 'notes', scope: 'global', description: '', toolNames: ['notes_add'] },
    ],
  }
}

test('a mini app the agent may not use contributes nothing to its run', () => {
  const narrowed = narrowLoadedMiniApps(loaded(), ['tiles'])
  expect(narrowed.tools.map((entry) => entry.name)).toEqual(['notes_add'])
  expect(narrowed.hooks.map((entry) => entry.app)).toEqual(['notes'])
  expect(narrowed.promptSections.map((entry) => entry.app)).toEqual(['notes'])
  expect(narrowed.guides.map((entry) => entry.app)).toEqual(['notes'])
  expect(narrowed.memory).toBeNull()
  expect(narrowed.loaded.map((entry) => entry.name)).toEqual(['notes'])
})

test('nothing denied is the load itself', () => {
  const all = loaded()
  expect(narrowLoadedMiniApps(all, [])).toBe(all)
})
