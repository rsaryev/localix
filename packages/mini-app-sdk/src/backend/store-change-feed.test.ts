import { expect, test } from 'bun:test'
import { createStoreChangeFeed } from './store-change-feed'
import type { PluginPathWatch } from './context'
import type { StoreFrame } from '../store-changes'

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
test('one store feed proves native coverage, batches writes and disk edits, and releases both on shutdown', async () => {
  let write: (path: string) => void = () => {}
  let disk: () => void = () => {}
  let fail: () => void = () => {}
  let releases = 0
  const watchPath: PluginPathWatch = (_path, _recursive, event, error) => {
    disk = () => event('game.json')
    fail = error
    return () => {
      releases++
    }
  }
  const feed = createStoreChangeFeed({
    plugin: 'game',
    resolveDir: async (user, session) => (user === 'owner' && session === 's' ? '/scope' : null),
    subscribeWrites: (listener) => {
      write = listener
      return () => {
        releases++
      }
    },
    watchPath,
    windowMs: 0,
  })
  const frames: StoreFrame[] = []
  const contribution = feed.wsFrames[0]!
  const handle = contribution.start({ sessionId: 's' }, (json) => frames.push(JSON.parse(json)), {
    userId: 'owner',
  })
  await tick()
  expect(frames).toContainEqual({ plugin: 'game', sessionId: 's', live: true })
  expect(frames.filter((frame) => frame.live === undefined)).toHaveLength(1)
  write('/other/a.json')
  await tick()
  expect(frames.filter((frame) => frame.live === undefined)).toHaveLength(1)
  write('/scope/game.json')
  write('/scope/game.json')
  disk()
  await tick()
  expect(frames.filter((frame) => frame.live === undefined)).toHaveLength(2)
  fail()
  await tick()
  expect(frames).toContainEqual({ plugin: 'game', sessionId: 's', live: false })
  contribution.stop(handle)
  expect(releases).toBe(2)
  const count = frames.length
  disk()
  write('/scope/game.json')
  await tick()
  expect(frames).toHaveLength(count)
  feed.onShutdown()
})
test('an unauthorized scope or absent native watcher never claims full live coverage', async () => {
  const frames: StoreFrame[] = []
  let subscriptions = 0
  const feed = createStoreChangeFeed({
    plugin: 'game',
    resolveDir: async (user) => (user === 'owner' ? '/scope' : null),
    subscribeWrites: () => {
      subscriptions++
      return () => {}
    },
    windowMs: 0,
  })
  const source = feed.wsFrames[0]!
  source.start({ sessionId: 's' }, (json) => frames.push(JSON.parse(json)), { userId: 'other' })
  await tick()
  expect(subscriptions).toBe(0)
  expect(frames).toEqual([{ plugin: 'game', sessionId: 's', live: false }])
  source.start({ sessionId: 's' }, (json) => frames.push(JSON.parse(json)), { userId: 'owner' })
  await tick()
  expect(subscriptions).toBe(1)
  expect(frames.some((frame) => frame.live === true)).toBe(false)
  feed.onShutdown()
})
