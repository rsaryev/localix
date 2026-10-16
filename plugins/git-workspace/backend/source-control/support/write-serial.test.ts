import { expect, test } from 'bun:test'

import { createWriteSerializer, retryOnLockContention } from './write-serial'

test('writes to one repository run in order, a failure releases the queue, repos stay parallel', async () => {
  const serialize = createWriteSerializer()
  const order: string[] = []
  const step =
    (name: string, ms: number, fail = false) =>
    async () => {
      order.push(`start ${name}`)
      await new Promise((r) => setTimeout(r, ms))
      order.push(`end ${name}`)
      if (fail) throw new Error(name)
      return name
    }
  const a = serialize('/repo', step('a', 20, true))
  const b = serialize('/repo', step('b', 1))
  const other = serialize('/other', step('other', 1))
  await expect(a).rejects.toThrow('a')
  expect(await b).toBe('b')
  expect(await other).toBe('other')
  expect(order.indexOf('start b')).toBeGreaterThan(order.indexOf('end a'))
  expect(order.indexOf('end other')).toBeLessThan(order.indexOf('end a'))
})

test('only lock contention is retried, and only twice', async () => {
  let calls = 0
  const locked = () => {
    calls += 1
    return Promise.reject(new Error("fatal: Unable to create '.git/index.lock': File exists."))
  }
  await expect(retryOnLockContention(locked, 1)).rejects.toThrow('index.lock')
  expect(calls).toBe(3)

  calls = 0
  const flaky = async () => {
    calls += 1
    if (calls === 1) throw new Error('Another git process seems to be running')
    return 'ok'
  }
  expect(await retryOnLockContention(flaky, 1)).toBe('ok')

  calls = 0
  const rejected = () => {
    calls += 1
    return Promise.reject(new Error('! [rejected] main -> main (non-fast-forward)'))
  }
  await expect(retryOnLockContention(rejected, 1)).rejects.toThrow('rejected')
  expect(calls).toBe(1)
})
