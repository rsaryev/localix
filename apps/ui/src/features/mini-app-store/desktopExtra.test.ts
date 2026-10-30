import { expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'
import type { MiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'
import { desktopExtra } from './desktopExtra'

test('a mini app with a screen of its own can become a desktop app, made with its title', async () => {
  const asked: string[] = []
  const port: MiniAppDesktopApps = {
    available: (name, surfaces) => name !== 'blocked' && Boolean(surfaces?.includes('workbench')),
    installed: () => ['puzzle'],
    subscribe: () => () => {},
    refresh: () => {},
    install: async (name, title) => void asked.push(`make ${name} ${title}`),
    remove: async (name) => void asked.push(`remove ${name}`),
  }
  const extra = desktopExtra(port, ['puzzle'])
  const puzzle = makeListing({ id: 'puzzle', displayName: 'Puzzle', contents: { screen: 1 } })
  expect(extra.available(puzzle)).toBe(true)
  expect(extra.available(makeListing({ id: 'notes', contents: { 'agent-tool': 1 } }))).toBe(false)
  expect(
    extra.available(makeListing({ id: 'puzzle', kind: 'plugin', contents: { screen: 1 } })),
  ).toBe(false)
  expect(extra.has(puzzle)).toBe(true)
  expect([extra.label, extra.makes]).toEqual(['Install as app', 'desktop app'])
  await extra.make(puzzle)
  await extra.remove(puzzle)
  expect(asked).toEqual(['make puzzle Puzzle', 'remove puzzle'])
})

test('an app a marketplace installed is its desktop app by its name, not its identity', async () => {
  const asked: string[] = []
  const port: MiniAppDesktopApps = {
    available: (name) => name === 'puzzle',
    installed: () => ['puzzle'],
    subscribe: () => () => {},
    refresh: () => {},
    install: async (name, title) => void asked.push(`make ${name} ${title}`),
    remove: async (name) => void asked.push(`remove ${name}`),
  }
  const extra = desktopExtra(port, ['puzzle'])
  const puzzle = makeListing({
    id: 'puzzle@localix',
    name: 'puzzle',
    displayName: 'Puzzle',
    contents: { screen: 1 },
  })
  expect([extra.available(puzzle), extra.has(puzzle)]).toEqual([true, true])
  await extra.make(puzzle)
  await extra.remove(puzzle)
  expect(asked).toEqual(['make puzzle Puzzle', 'remove puzzle'])
})
