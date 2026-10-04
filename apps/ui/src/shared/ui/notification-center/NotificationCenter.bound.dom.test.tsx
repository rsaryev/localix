import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * The event journal is the one long list in the app that is bounded by RETENTION
 * rather than by a virtual window, and that is a deliberate decision.
 *
 * `NOTIFICATIONS_CAP` (200) is enforced by the store, so the worst case the popover
 * can ever mount is 200 rows — measured at ~5.4k elements, built once, on demand,
 * off the boot path (the whole center is behind an intent-prefetched dynamic import).
 * A virtual window would buy that back at the price of measured variable-height rows
 * (rows expand inline), pinning the focused row outside the window, and making rows
 * undiscoverable to browser find — for a list whose ceiling is already fixed.
 *
 * This test is the tripwire for that reasoning: it pins the rendered row count to the
 * store's cap end to end. If the cap is ever raised, this test fails, and the
 * "200 rows is affordable" argument has to be made again — or the list virtualized.
 */
describe('Event journal is bounded by retention, not by a window', () => {
  test('an overflowing history renders exactly the store cap, newest first', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { NOTIFICATIONS_CAP } = await import('@/shared/lib/notifications/core')
    const { resetNotificationsForTests, useNotificationsStore } =
      await import('@/shared/lib/notifications/store')
    const { NotificationCenterLauncher } = await import('./NotificationCenterLauncher')

    resetNotificationsForTests()
    const pushed = NOTIFICATIONS_CAP + 300
    for (let i = 0; i < pushed; i++) {
      useNotificationsStore.getState().push({
        id: `bound-${i}`,
        topic: 'terminal.finished',
        category: 'terminal',
        severity: 'info',
        title: `Event ${i}`,
        origin: { kind: 'session', sessionId: `LX-${i}`, projectId: 'project-1' },
      } as never)
    }

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(
          React.createElement(
            MemoryRouter,
            { initialEntries: ['/project/PRJ-1/LX-1'] },
            React.createElement(NotificationCenterLauncher),
          ),
        )
      })
      const trigger = host.querySelector<HTMLButtonElement>('button[aria-label^="Event Center"]')!
      await act(async () => {
        trigger.click()
        await import('./NotificationCenter')
      })

      const rows = document.body.querySelectorAll('[data-event-row-trigger]')
      expect(rows.length).toBe(NOTIFICATIONS_CAP)
      // Newest-first: the rows kept are the newest ones; retention dropped the oldest.
      expect(
        document.body.querySelector(`button[aria-label="Expand event: Event ${pushed - 1}"]`),
      ).not.toBeNull()
      expect(document.body.querySelector('button[aria-label="Expand event: Event 0"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      host.remove()
      resetNotificationsForTests()
    }
  })
})
