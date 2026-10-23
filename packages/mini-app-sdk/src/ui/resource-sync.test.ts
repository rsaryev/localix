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

/** A reader whose reads the test settles one by one. */
function controlledReader() {
  const pending: Array<{ resolve: (value: number) => void; reject: (error: Error) => void }> = []
  const applied: number[] = []
  const aborted: number[] = []
  let reads = 0
  return {
    applied,
    aborted,
    reads: () => reads,
    pending: () => pending.length,
    resolveNext: (value: number) => pending.shift()!.resolve(value),
    rejectNext: (error = new Error('offline')) => pending.shift()!.reject(error),
    reader: {
      read: (signal: AbortSignal) => {
        reads++
        const index = reads
        return new Promise<number>((resolve, reject) => {
          const entry = { resolve, reject }
          pending.push(entry)
          // Like a network read, an aborted read rejects.
          signal.addEventListener('abort', () => {
            aborted.push(index)
            pending.splice(pending.indexOf(entry), 1)
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      },
      apply: (value: number) => void applied.push(value),
    },
  }
}

test('nothing is read until the transport is connected, then each resource once', async () => {
  const sync = createResourceSync()
  const r = controlledReader()
  sync.register('a', r.reader)
  await tick()
  expect(r.reads()).toBe(0)
  sync.connected()
  await tick()
  expect(r.reads()).toBe(1)
  r.resolveNext(1)
  await tick()
  expect(r.applied).toEqual([1])
  sync.disconnected()
})

test('a burst of invalidations while a read runs coalesces into one follow-up read', async () => {
  const sync = createResourceSync()
  const r = controlledReader()
  sync.register('a', r.reader)
  sync.connected()
  await tick()
  sync.invalidate(['a'])
  sync.invalidate(['a'])
  sync.invalidate(['a'])
  r.resolveNext(1)
  await tick()
  expect(r.applied).toEqual([])
  expect(r.reads()).toBe(2)
  r.resolveNext(2)
  await tick()
  expect(r.applied).toEqual([2])
  expect(r.reads()).toBe(2)
  sync.disconnected()
})

test('a stream patch supersedes a running read but does not start one on settled data', async () => {
  const sync = createResourceSync()
  const r = controlledReader()
  sync.register('a', r.reader)
  sync.connected()
  await tick()
  r.resolveNext(1)
  await tick()
  sync.invalidate(['a'], false)
  await tick()
  expect(r.reads()).toBe(1)

  sync.invalidate(['a'])
  await tick()
  sync.invalidate(['a'], false)
  r.resolveNext(2)
  await tick()
  expect(r.applied).toEqual([1])
  expect(r.reads()).toBe(3)
  r.resolveNext(3)
  await tick()
  expect(r.applied).toEqual([1, 3])
  sync.disconnected()
})

test('failed reads retry on the policy, then report the error once', async () => {
  const sync = createResourceSync({ retryDelaysMs: [0, 0] })
  const errors: unknown[] = []
  let reads = 0
  sync.register('a', {
    read: async () => {
      reads++
      throw new Error('offline')
    },
    apply: () => {},
    onError: (error) => void errors.push(error),
  })
  sync.connected()
  await tick()
  await tick()
  expect(reads).toBe(3)
  expect(errors).toHaveLength(1)
  sync.disconnected()
})

test('a disconnect aborts the running read and its late answer is never applied', async () => {
  const sync = createResourceSync()
  const r = controlledReader()
  sync.register('a', r.reader)
  sync.connected()
  await tick()
  sync.disconnected()
  expect(r.aborted).toEqual([1])
  expect(r.pending()).toBe(0)
  await tick()
  expect(r.applied).toEqual([])
})

test('a reconnect with no replay reads every resource again', async () => {
  const sync = createResourceSync()
  const a = controlledReader()
  const b = controlledReader()
  sync.register('a', a.reader)
  sync.register('b', b.reader)
  sync.connected()
  await tick()
  a.resolveNext(1)
  b.resolveNext(1)
  await tick()
  sync.disconnected()
  sync.connected()
  await tick()
  expect([a.reads(), b.reads()]).toEqual([2, 2])
  sync.disconnected()
})

test('a reconnect after a full replay reads only what the outage cut off', async () => {
  const sync = createResourceSync()
  const settled = controlledReader()
  const cutOff = controlledReader()
  sync.register('settled', settled.reader)
  sync.register('cut', cutOff.reader)
  sync.connected()
  await tick()
  settled.resolveNext(1)
  await tick()
  // `cut` is still reading when the connection drops.
  sync.disconnected()
  sync.connected({ replayed: true })
  await tick()
  expect(settled.reads()).toBe(1)
  expect(cutOff.reads()).toBe(2)
  cutOff.resolveNext(5)
  await tick()
  expect(cutOff.applied).toEqual([5])
  sync.disconnected()
})

test('a replayed invalidation still reads what it names', async () => {
  const sync = createResourceSync()
  const r = controlledReader()
  sync.register('a', r.reader)
  sync.connected()
  await tick()
  r.resolveNext(1)
  await tick()
  sync.disconnected()
  sync.connected({ replayed: true })
  // A frame missed during the outage, replayed by the transport.
  sync.invalidate(['a'])
  await tick()
  expect(r.reads()).toBe(2)
  sync.disconnected()
})

test('observers hear a read invalidation once per tick, never a stream patch', async () => {
  const sync = createResourceSync()
  let heard = 0
  const off = sync.subscribe('a', () => void heard++)
  sync.connected()
  await tick()
  heard = 0
  sync.invalidate(['a'])
  sync.invalidate(['a'])
  await tick()
  expect(heard).toBe(1)
  sync.invalidate(['a'], false)
  await tick()
  expect(heard).toBe(1)
  off()
  sync.invalidate(['a'])
  await tick()
  expect(heard).toBe(1)
  sync.disconnected()
})

test('an unregistered reader is aborted and never applies again', async () => {
  const sync = createResourceSync()
  const r = controlledReader()
  const stop = sync.register('a', r.reader)
  sync.connected()
  await tick()
  stop()
  expect(r.aborted).toEqual([1])
  sync.invalidate(['a'])
  await tick()
  expect(r.applied).toEqual([])
  expect(r.reads()).toBe(1)
  sync.disconnected()
})
