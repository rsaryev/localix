import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * The startup staging rule, pinned.
 *
 * Eight process-wide installers used to fire in one commit before the app could
 * paint. They are now split by what they can actually observe, not by cost:
 * anything that watches boot itself stays eager, everything that needs a painted
 * UI first is staged onto `installWhenIdle`.
 *
 * These assertions read the source rather than the runtime because the property
 * under test is WHERE a call sits in the composition root — the thing a later
 * refactor silently undoes by adding one more eager `useEffect`.
 */
const rootLayout = readFileSync(new URL('./RootLayout.tsx', import.meta.url), 'utf8')
const chatPage = readFileSync(new URL('../pages/chat/ui/ChatPage.tsx', import.meta.url), 'utf8')

/** Installers that must be live before the first paint, and why. */
const EAGER = [
  // Boot-time crashes are exactly what this exists to journal.
  'startGlobalErrorCapture',
  // Fallback timers armed by boot requests read the publisher within 900 ms.
  'startUnreportedFailurePublisher',
  // The settings bootstrap and the shell's mount requests are boot traffic.
  'startRpcEventTracing',
  'startHttpEventTracing',
  // The socket's first connect diagnostic is a one-shot event.
  'startRealtimeEventTracing',
  // The first connect is when the bell and the dock badge learn the server journal.
  'startNotificationSync',
] as const

/** Installers with nothing to observe until the user can act on a painted UI. */
const STAGED = [
  'startChatNotificationCommands',
  'startUserIntentCapture',
  'startDesktopEventTracing',
] as const

test.each([...EAGER])('%s runs before paint', (installer) => {
  expect(rootLayout).toContain(`useEffect(() => ${installer}(`)
  expect(rootLayout).not.toContain(`installWhenIdle(${installer})`)
})

test.each([...STAGED])('%s is staged onto idle', (installer) => {
  expect(rootLayout).toContain(`useEffect(() => installWhenIdle(${installer}), [])`)
  // The staged form must be the ONLY call site; an eager call alongside it would
  // install the same listener twice.
  expect(rootLayout).not.toContain(`useEffect(() => ${installer}(`)
})

test('every staged installer goes through the shared idle primitive', () => {
  expect(rootLayout).toContain("import { installWhenIdle } from '@/shared/lib/runWhenIdle'")
  // Counted, so adding a fourth staged installer without classifying it — and
  // without stating its gap risk — fails here.
  const staged = rootLayout.match(/installWhenIdle\(/gu) ?? []
  expect(staged).toHaveLength(STAGED.length)
})

test('UI discovery and grid hydration stay eager, in that order', () => {
  // The load-bearing one: `hydrateGrid()` filters the restored layout against the
  // work-item kind registry `discoverUi()` fills. Deferring either — or swapping
  // them — restores tabs into kinds that are not registered yet, which presents as
  // a user's saved layout quietly losing tabs.
  const discover = chatPage.indexOf('\ndiscoverUi()')
  const hydrate = chatPage.indexOf('\nhydrateGrid()')
  expect(discover).toBeGreaterThan(-1)
  expect(hydrate).toBeGreaterThan(discover)
  expect(chatPage).not.toMatch(/(?:installWhenIdle|runWhenIdle)\(/u)
})
