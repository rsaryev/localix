import { expect, test } from 'bun:test'
import { makeListing } from '@localixai/store/testing'
import type { MiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'
import { desktopExtra } from './desktopExtra'

test('a mini app with a screen of its own can become a desktop app, made with its title', async () => {
  const asked: string[] = []
  const port: MiniAppDesktopApps = {
    available: (name, surfaces) => name !== 'blocked' && Boolean(surfaces?.includes('workbench')),
    installed: () => ['chess'],
    subscribe: () => () => {},
    refresh: () => {},
    install: async (name, title) => void asked.push(`make ${name} ${title}`),
    remove: async (name) => void asked.push(`remove ${name}`),
  }
  const extra = desktopExtra(port, ['chess'])
  const chess = makeListing({ id: 'chess', displayName: 'Chess', contents: { screen: 1 } })
  expect(extra.available(chess)).toBe(true)
  expect(extra.available(makeListing({ id: 'notes', contents: { 'agent-tool': 1 } }))).toBe(false)
  expect(
    extra.available(makeListing({ id: 'chess', kind: 'plugin', contents: { screen: 1 } })),
  ).toBe(false)
  expect(extra.has(chess)).toBe(true)
  expect([extra.label, extra.makes]).toEqual(['Install as app', 'desktop app'])
  await extra.make(chess)
  await extra.remove(chess)
  expect(asked).toEqual(['make chess Chess', 'remove chess'])
})
