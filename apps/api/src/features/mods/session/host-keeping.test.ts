import { expect, test } from 'bun:test'
import type { ModsHost as KitModsHost } from '@rsaryev/llx-plugin/mods'
import { manualClock } from '../isolation/testing/testing-mods'
import { createHostKeeping, type HostKeepingDeps } from './host-keeping'
import { keyOf, type Live } from './live-hosts'

/** Which conversations' hosts stay: idle, the limit, and work that holds a host. */

function keeping(more: Partial<HostKeepingDeps> = {}) {
  const live = new Map<string, Live>()
  const ended: string[] = []
  const clock = manualClock()
  const keep = createHostKeeping({ live, clock, idleMs: 40, maxHosts: 2, ...more })
  const open = (sessionId?: string) => {
    const scene = { userId: '', cwd: '/w', ...(sessionId ? { sessionId } : {}) }
    const kit = {
      endSession: async () => void ended.push(keyOf(scene)),
      dispose: async () => {},
      ui: { panes: { list: () => [] } },
    } as unknown as KitModsHost
    const entry: Live = { host: Promise.resolve(kit), revision: '1', scene, sources: [] }
    entry.ready = { kit, failures: new Map() }
    live.set(keyOf(scene), entry)
    keep.touch(keyOf(scene), entry)
    return scene
  }
  return { live, ended, clock, keep, open }
}

test("the workspace's host neither counts toward the conversations' limit nor goes for it", async () => {
  const { live, keep, open } = keeping()
  open()
  for (const id of ['a', 'b', 'c']) open(id)
  await keep.evict()
  expect([...live.keys()]).toEqual(['workspace:/w', 'b', 'c'])
})

test('a host in use is not the oldest to go past the limit, nor idle', async () => {
  const { live, clock, keep, open, ended } = keeping()
  const a = open('a')
  const gate = Promise.withResolvers<void>()
  const held = keep.holding(a, () => gate.promise)
  for (const id of ['b', 'c']) open(id)
  await keep.evict()
  expect([...live.keys()]).toEqual(['a', 'c'])
  clock.advance(100)
  await Promise.resolve()
  expect([...live.keys()]).toEqual(['a'])
  gate.resolve()
  await held
  clock.advance(40)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(ended).toEqual(['b', 'c', 'a'])
})

test('a host whose turn runs is not idle', () => {
  const { live, clock, open } = keeping({ turnOf: () => ({}) })
  open('s1')
  clock.advance(100)
  expect(live.size).toBe(1)
})
