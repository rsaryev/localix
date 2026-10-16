import { expect, test } from 'bun:test'
import { createPushWait } from './lsp-push-wait'

test('one push settles every waiter for that file and leaves other files waiting', async () => {
  const { waitForPush, notifyDiagnosticsListeners } = createPushWait()
  const first = waitForPush('/same', 5)
  const second = waitForPush('/same', 5)
  const other = waitForPush('/other', 5)
  notifyDiagnosticsListeners('/unrelated')
  notifyDiagnosticsListeners('/same')
  expect(await Promise.all([first, second, other])).toEqual([true, true, false])
})

test('cleared listeners finish at their deadlines and later waits can receive a push', async () => {
  const { waitForPush, notifyDiagnosticsListeners, clearListeners } = createPushWait()
  const old = waitForPush('/same', 5)
  clearListeners()
  const current = waitForPush('/same', 5)
  notifyDiagnosticsListeners('/same')
  expect(await current).toBe(true)
  expect(await old).toBe(false)
})

test('a push after the deadline cannot change the completed result', async () => {
  const { waitForPush, notifyDiagnosticsListeners } = createPushWait()
  const expired = waitForPush('/same', 0)
  expect(await expired).toBe(false)
  notifyDiagnosticsListeners('/same')
  expect(await expired).toBe(false)
})
