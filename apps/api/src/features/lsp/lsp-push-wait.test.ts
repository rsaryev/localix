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

// vtsls publishes only what changed: of two clean files written together, one gets a push and the
// other none, and an agent's every multi-file write used to wait out the whole deadline for it.
test('a file the server checked and left unchanged settles once the server goes quiet', async () => {
  const { waitForPush, notifyDiagnosticsListeners } = createPushWait({ quietMs: 5 })
  const unchanged = waitForPush('/index.ts', 1_000)
  notifyDiagnosticsListeners('/meals.ts')
  expect(await unchanged).toBe(true)
})
