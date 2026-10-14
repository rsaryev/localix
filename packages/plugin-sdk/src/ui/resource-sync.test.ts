import { expect, test } from 'bun:test'
import { createResourceSync } from './resource-sync'

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

test('refresh waits for the superseding read and discards an older response', async () => {
  const sync = createResourceSync()
  const releases: Array<(value: number) => void> = []
  const applied: number[] = []
  const stop = sync.register('a', {
    read: () => new Promise<number>((resolve) => releases.push(resolve)),
    apply: (value) => applied.push(value),
  })
  sync.connected()
  await tick()
  let done = false
  const refresh = sync.refresh(['a']).then(() => {
    done = true
  })
  releases[0]!(1)
  await tick()
  expect(applied).toEqual([])
  expect(done).toBe(false)
  releases[1]!(2)
  await refresh
  expect(applied).toEqual([2])
  stop()
  sync.disconnected()
})

test('an explicit invalidation cancels retry delay and teardown settles refresh waiters', async () => {
  const sync = createResourceSync({ retryDelaysMs: [60_000] })
  let calls = 0
  const stop = sync.register('a', {
    read: async () => {
      calls++
      if (calls === 1) throw new Error('offline')
      return calls
    },
    apply: () => {},
  })
  sync.connected()
  await tick()
  const refresh = sync.refresh(['a'])
  await tick()
  expect(calls).toBe(2)
  await refresh
  const final = sync.refresh(['a'])
  stop()
  await final
  sync.disconnected()
})
