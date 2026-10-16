import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { createJsonStoreFeed as createStoreFeed, openJsonStore } from './json-store'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function folders() {
  const root = mkdtempSync(join(tmpdir(), 'store-feed-'))
  roots.push(root)
  return { mine: join(root, 'chat-a'), other: join(root, 'chat-ab') }
}

const counter = (dir: string) =>
  openJsonStore({ dir, file: 'count.json', schema: z.object({ n: z.number() }), initial: { n: 0 } })
// Wide enough that three queued writes land inside one window on a loaded machine.
const WINDOW_MS = 150
const settle = () => new Promise((resolve) => setTimeout(resolve, WINDOW_MS * 3))

function start(dirs: Record<string, string>) {
  const feed = createStoreFeed({
    plugin: 'probe',
    resolveDir: async (userId, sessionId) =>
      userId === 'me' && sessionId ? (dirs[sessionId] ?? null) : null,
    windowMs: WINDOW_MS,
  })
  const contribution = feed.wsFrames[0]!
  const sent: string[] = []
  const handle = contribution.start({ sessionId: 'a' }, (data) => sent.push(data), {
    userId: 'me',
  })
  return { feed, contribution, handle, sent }
}

/**
 * The board learned of the agent's move only by polling — every 800 ms while it owed one. A write
 * through the store now nudges the open view of THAT scope, once per burst, and nobody else.
 */
test('a write under the followed folder nudges once per burst, and only that scope', async () => {
  const { mine, other } = folders()
  const { sent, contribution, handle } = start({ a: mine })
  await settle()
  // The first nudge closes the gap between the view's last read and the subscription.
  expect(sent).toEqual([
    JSON.stringify({ plugin: 'probe', sessionId: 'a', live: false }),
    JSON.stringify({ plugin: 'probe', sessionId: 'a' }),
  ])

  const store = counter(mine)
  await Promise.all([1, 2, 3].map((n) => store.update(() => ({ n }))))
  // `chat-ab` shares the prefix `chat-a`: the separator keeps it from matching.
  await counter(other).update(() => ({ n: 9 }))
  await settle()
  expect(sent).toHaveLength(3)

  contribution.stop(handle)
  await store.update(() => ({ n: 4 }))
  await settle()
  expect(sent).toHaveLength(3)
})

test('a scope the socket’s user may not follow reports unavailable without data', async () => {
  const { mine } = folders()
  const feed = createStoreFeed({
    plugin: 'probe',
    resolveDir: async () => null,
    windowMs: WINDOW_MS,
  })
  const sent: string[] = []
  feed.wsFrames[0]!.start({ sessionId: 'a' }, (data) => sent.push(data), { userId: 'someone' })
  await counter(mine).update(() => ({ n: 1 }))
  await settle()
  expect(sent).toEqual([JSON.stringify({ plugin: 'probe', sessionId: 'a', live: false })])
})

test('the commands are the plugin’s own, and shutdown releases live streams', async () => {
  const { mine } = folders()
  const { feed, contribution, sent } = start({ a: mine })
  expect(contribution.subscribeCommand).toBe('probe:store.subscribe')
  expect(contribution.unsubscribeCommand).toBe('probe:store.unsubscribe')
  await settle()
  feed.onShutdown()
  await counter(mine).update(() => ({ n: 1 }))
  await settle()
  expect(sent).toHaveLength(2)
})

test('concurrent updates apply in order and every opener of a file shares one queue', async () => {
  const { mine } = folders()
  const first = counter(mine)
  const second = counter(mine)
  expect(second).toBe(first)
  await Promise.all(
    Array.from({ length: 20 }, () => [first, second])
      .flat()
      .map((store) => store.update((current) => ({ n: current.n + 1 }))),
  )
  expect(await first.read()).toEqual({ n: 40 })
  expect(readdirSync(mine)).toEqual(['count.json'])
})

test('a corrupt or invalid file reads as the initial value, and a rejected change persists nothing', async () => {
  const { mine } = folders()
  const store = counter(mine)
  await store.update(() => ({ n: 1 }))
  writeFileSync(join(mine, 'count.json'), '{"n": ')
  expect(await store.read()).toEqual({ n: 0 })
  writeFileSync(join(mine, 'count.json'), '{"n": "x"}')
  expect(await store.read()).toEqual({ n: 0 })
  await store.update(() => ({ n: 5 }))
  await expect(store.update(() => ({ n: 'bad' }) as never)).rejects.toThrow()
  expect(await store.read()).toEqual({ n: 5 })
})
