import { expect, test } from 'bun:test'
import { latestOnly } from './latestOnly'

function deferredSend() {
  const sent: number[] = []
  const finish: Array<(failure?: Error) => void> = []
  const send = (value: number) => {
    sent.push(value)
    return new Promise<void>((resolve, reject) =>
      finish.push((failure) => (failure ? reject(failure) : resolve())),
    )
  }
  const settle = async (failure?: Error) => {
    finish.shift()?.(failure)
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
  }
  return { sent, send, settle }
}

test('a burst sends the first value, then only the newest once the bridge answers', async () => {
  const bridge = deferredSend()
  const deliver = latestOnly(bridge.send, () => {})
  deliver(400)
  deliver(500)
  deliver(600)
  expect(bridge.sent).toEqual([400])
  await bridge.settle()
  expect(bridge.sent).toEqual([400, 600])
})

test('a value equal to the last delivered one never reaches the bridge', async () => {
  const bridge = deferredSend()
  const deliver = latestOnly(bridge.send, () => {})
  deliver(600)
  await bridge.settle()
  deliver(600)
  expect(bridge.sent).toEqual([600])
})

test('a failed delivery is reported, and the same value may be sent again', async () => {
  const bridge = deferredSend()
  const failures: unknown[] = []
  const deliver = latestOnly(bridge.send, (reason) => failures.push(reason))
  deliver(1)
  await bridge.settle(new Error('page not ready'))
  deliver(1)
  expect(failures).toHaveLength(1)
  expect(bridge.sent).toEqual([1, 1])
})

test('closing cancels queued frames and ignores a late in-flight failure', async () => {
  const bridge = deferredSend()
  const failures: unknown[] = []
  const deliver = latestOnly(bridge.send, (reason) => failures.push(reason))
  deliver(1)
  deliver(2)
  deliver.cancel()
  await bridge.settle(new Error('closed page'))
  deliver(3)
  expect(bridge.sent).toEqual([1])
  expect(failures).toEqual([])
})

test('disposal sends the terminal hide after an in-flight visible frame', async () => {
  const bridge = deferredSend()
  const deliver = latestOnly(bridge.send, () => {})
  deliver(1)
  deliver(2)
  deliver.dispose(0)
  deliver(3)
  expect(bridge.sent).toEqual([1])
  await bridge.settle()
  expect(bridge.sent).toEqual([1, 0])
  await bridge.settle()
  deliver(4)
  expect(bridge.sent).toEqual([1, 0])
})

test('a failed in-flight frame still drains the final hide without stale error reports', async () => {
  const bridge = deferredSend()
  const failures: unknown[] = []
  const deliver = latestOnly(bridge.send, (error) => failures.push(error))
  deliver(1)
  deliver.dispose(0)
  await bridge.settle(new Error('retired renderer'))
  expect(bridge.sent).toEqual([1, 0])
  expect(failures).toEqual([])
})
