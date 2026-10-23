import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { NotificationInput } from '@/shared/lib/notifications/types'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

async function mountCenter() {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter, useLocation } = await import('react-router')
  const { resetNotificationsForTests, seedNotificationsForTests, useNotificationsStore } =
    await import('@/shared/lib/notifications/store')
  const { NotificationCenterLauncher } = await import('./NotificationCenterLauncher')
  const { useEventFocusStore } = await import('@/shared/lib/eventFocusBus')

  resetNotificationsForTests()
  useEventFocusStore.setState({ pending: null, active: null, sequence: 0 })
  // The journal as the server reports it, newest first: a repeated build failure, then a request.
  const approval = {
    id: 'hitl-1',
    ts: Date.now() - 1_000,
    topic: 'hitl.required',
    category: 'human-input',
    severity: 'warning',
    title: 'Approve deployment',
    message: 'Production deploy is waiting for confirmation.',
    origin: {
      kind: 'resource',
      sessionId: 'LOCALIX-14',
      projectId: 'project-1',
      resourceKind: 'interaction',
      resourceId: 'request-1',
      label: 'Agent',
    },
    trace: [
      {
        id: 'trace-1',
        ts: Date.now(),
        kind: 'hitl.required',
        summary: 'Agent requested approval',
        origin: {
          kind: 'resource',
          sessionId: 'LOCALIX-14',
          projectId: 'project-1',
          resourceKind: 'interaction',
          resourceId: 'request-1',
        },
        attributes: { requestId: 'request-1', mode: 'approval' },
      },
      {
        id: 'trace-2',
        ts: Date.now(),
        kind: 'rpc.interact',
        summary: 'Tool interaction failed',
        phase: 'failed',
        origin: {
          kind: 'resource',
          sessionId: 'LOCALIX-14',
          projectId: 'project-1',
          resourceKind: 'tool',
          resourceId: 'call-7',
        },
      },
    ],
    actions: [
      {
        id: 'respond',
        label: 'Respond',
        kind: 'navigate',
        target: {
          kind: 'session',
          sessionId: 'LOCALIX-14',
          projectId: 'project-1',
          focus: 'interaction',
        },
        requestId: 'request-1',
        available: true,
      },
    ],
  } satisfies NotificationInput
  seedNotificationsForTests([
    {
      id: 'terminal-1',
      topic: 'terminal.finished',
      category: 'terminal',
      severity: 'error',
      title: 'Build failed',
      origin: { kind: 'session', sessionId: 'LOCALIX-9', projectId: 'project-1' },
      occurrenceCount: 3,
      firstSeenAt: Date.now() - 2_000,
      lastSeenAt: Date.now(),
    },
    approval,
  ])

  function LocationProbe() {
    return <output data-testid="location">{useLocation().pathname}</output>
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/project/PRJ-1/LOCALIX-18']}>
        <NotificationCenterLauncher />
        <LocationProbe />
      </MemoryRouter>,
    ),
  )

  return {
    act,
    host,
    store: useNotificationsStore,
    focusStore: useEventFocusStore,
    dispose: async () => {
      await act(async () => root.unmount())
      host.remove()
      resetNotificationsForTests()
      useEventFocusStore.setState({ pending: null, active: null, sequence: 0 })
    },
  }
}

describe('Event Center', () => {
  test('keeps rows compact and exposes source navigation at the top level', async () => {
    const view = await mountCenter()
    try {
      const trigger = view.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Event Center, 2 unread"]',
      )
      expect(trigger).not.toBeNull()
      await view.act(async () => {
        trigger!.click()
        await import('./NotificationCenter')
      })

      expect(document.body.textContent).toContain('2 events · 2 unread · 1 need action')
      expect(document.body.textContent).not.toContain('LOCALIX-14')
      expect(
        document.body.querySelector('input[placeholder="Search or filter events…"]'),
      ).not.toBeNull()
      // Type, severity and time are one "Filter" menu, not three framed selects in the popover.
      const filter = document.body.querySelector('button[aria-label="Filter events"]')
      expect(filter?.getAttribute('aria-haspopup')).toBe('menu')
      expect(document.body.querySelector('[role="dialog"] [role="combobox"]')).toBeNull()
      expect(document.body.querySelector('button[aria-label="Search syntax"]')).not.toBeNull()
      expect(document.body.textContent).toContain('×3')
      expect(document.body.querySelector('[role="dialog"] [title]')).toBeNull()
      expect(document.body.textContent).toContain('This session')
      expect(document.body.querySelector('[data-event-expanded]')).toBeNull()
      const eventRows = document.body.querySelectorAll('[data-event-row-trigger]')
      const sessionSlots = document.body.querySelectorAll('[data-event-session-action]')
      expect(sessionSlots).toHaveLength(eventRows.length)
      expect(
        document.body
          .querySelector('button[aria-label="Expand event: Approve deployment"]')
          ?.getAttribute('aria-describedby'),
      ).not.toBeNull()
      const scopeFilters = document.body.querySelector('[role="group"][aria-label="Event status"]')
      expect(scopeFilters).not.toBeNull()
      expect(scopeFilters?.querySelector('[role="tab"]')).toBeNull()
      const allFilter = [
        ...(scopeFilters?.querySelectorAll<HTMLButtonElement>('button') ?? []),
      ].find((button) => button.textContent?.trim() === 'All')
      expect(allFilter?.getAttribute('aria-pressed')).toBe('true')
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand event: Build failed')

      const openSession = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Open session LOCALIX-14"]',
      )
      expect(openSession).not.toBeNull()
      expect(openSession?.getAttribute('data-variant')).toBe('ghost')
      expect(openSession?.getAttribute('data-size')).toBe('icon-sm')
      expect(openSession!.textContent?.trim()).toBe('')
      await view.act(async () => openSession!.click())
      expect(view.host.querySelector('[data-testid="location"]')?.textContent).toContain(
        'LOCALIX-14',
      )
      expect(view.focusStore.getState().pending).toMatchObject({
        sessionId: 'LOCALIX-14',
        resourceKind: 'interaction',
        resourceId: 'request-1',
      })
      expect(view.focusStore.getState().active).toMatchObject({
        sessionId: 'LOCALIX-14',
        resourceKind: 'interaction',
        resourceId: 'request-1',
      })

      await view.act(async () => {
        trigger!.click()
        await import('./NotificationCenter')
      })
      const expand = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand event: Approve deployment"]',
      )
      expect(expand).not.toBeNull()
      await view.act(async () => expand!.click())
      expect(document.body.textContent).toContain('Production deploy is waiting for confirmation.')
      expect(document.body.textContent).toContain('Trace')
      expect(document.body.textContent).toContain('hitl.required')
      expect(document.body.textContent).toContain('requestId')
      expect(document.body.textContent).toContain('Needs action')
      expect(
        [...document.body.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === 'Respond',
        ),
      ).toBe(false)

      const openTraceResource = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Open trace resource tool call-7"]',
      )
      expect(openTraceResource).not.toBeNull()
      await view.act(async () => openTraceResource!.click())
      expect(view.focusStore.getState().pending).toMatchObject({
        sessionId: 'LOCALIX-14',
        resourceKind: 'tool',
        resourceId: 'call-7',
      })
    } finally {
      await view.dispose()
    }
  })

  test('supports keyboard navigation, focus-safe removal and quiet diagnostic copy', async () => {
    const view = await mountCenter()
    const { configurePlatformCapabilities } = await import('@/shared/lib/platformCapabilities')
    let copied = ''
    const restoreCapabilities = configurePlatformCapabilities({
      clipboard: {
        writeText: async (value) => {
          copied = value
          return true
        },
      },
    })
    try {
      const trigger = view.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Event Center, 2 unread"]',
      )
      await view.act(async () => {
        trigger!.click()
        await import('./NotificationCenter')
      })
      const build = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand event: Build failed"]',
      )!
      expect(document.activeElement).toBe(build)

      await view.act(async () => {
        build.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      const approval = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand event: Approve deployment"]',
      )!
      expect(document.activeElement).toBe(approval)

      await view.act(async () => {
        approval.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      expect(approval.getAttribute('aria-expanded')).toBe('true')
      const description = document.getElementById(approval.getAttribute('aria-describedby')!)
      expect(description?.textContent).toContain('Warning severity')
      // A body that ends its own sentence is not read out with a second full stop.
      expect(description?.textContent).not.toContain('..')
      expect(description?.textContent).toContain('needs action')

      const copy = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Copy event details"]',
      )!
      await view.act(async () => copy.click())
      expect(copied).toContain('Approve deployment')
      expect(copied).toContain('Origin: project-1 / LOCALIX-14 / interaction:request-1')
      expect(document.body.textContent).toContain('Event details copied')
      expect(view.store.getState().entries).toHaveLength(2)

      approval.focus()
      await view.act(async () => {
        approval.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
        await Promise.resolve()
      })
      expect(view.store.getState().entries.map((entry) => entry.id)).toEqual(['terminal-1'])
      expect(document.activeElement).toBe(build)
    } finally {
      restoreCapabilities()
      await view.dispose()
    }
  })

  test('clears settled history without hiding pending human work', async () => {
    const view = await mountCenter()
    try {
      const trigger = view.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Event Center, 2 unread"]',
      )
      await view.act(async () => {
        trigger!.click()
        await import('./NotificationCenter')
      })
      const clearHistory = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'Clear history',
      )
      expect(clearHistory?.hasAttribute('title')).toBe(false)
      expect(clearHistory?.getAttribute('data-tooltip-trigger')).toBe('true')

      await view.act(async () => clearHistory!.click())
      expect(view.store.getState().entries.map((entry) => entry.id)).toEqual(['hitl-1'])
      expect(document.body.textContent).toContain('Approve deployment')
      expect(document.body.textContent).not.toContain('Build failed')
      expect(
        [...document.body.querySelectorAll<HTMLButtonElement>('button')].some(
          (button) => button.textContent?.trim() === 'Clear history',
        ),
      ).toBe(false)
    } finally {
      await view.dispose()
    }
  })

  test('reading a row marks it read; Clear is offered only when it would remove something', async () => {
    const view = await mountCenter()
    try {
      await view.act(async () => {
        view.store.getState().push({
          id: 'application.condition:documents:/w/board.json:abc',
          topic: 'application.notification',
          category: 'system',
          severity: 'error',
          title: 'board.json has 2 problems',
          message: 'elements.a.type — missing\n  → write "recipe"',
          origin: { kind: 'application' },
          condition: true,
        })
        view.store.getState().push({
          id: 'answered',
          topic: 'hitl.required',
          category: 'human-input',
          severity: 'warning',
          title: 'Approve migration',
          origin: { kind: 'application' },
          resolvedAt: Date.now(),
          read: true,
        })
      })
      const trigger = view.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Event Center, 3 unread"]',
      )
      await view.act(async () => {
        trigger!.click()
        await import('./NotificationCenter')
      })
      // The body's first line is on the collapsed row; a settled row says so without expanding.
      expect(document.body.textContent).toContain('elements.a.type — missing')
      const answered = document.body.querySelector('[data-event-resolved]')
      expect(answered?.textContent).toContain('Resolved')

      const build = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand event: Build failed"]',
      )
      await view.act(async () => build!.click())
      expect(view.store.getState().entries.find((entry) => entry.id === 'terminal-1')?.read).toBe(
        true,
      )

      const clear = () =>
        [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent?.trim() === 'Clear history',
        )
      await view.act(async () => clear()!.click())
      // Left: the pending request and the problem that is still true. Nothing more would clear, so
      // the button that would do nothing is gone.
      expect(
        view.store
          .getState()
          .entries.map((entry) => entry.id)
          .sort(),
      ).toEqual(['application.condition:documents:/w/board.json:abc', 'hitl-1'])
      expect(clear()).toBeUndefined()
    } finally {
      await view.dispose()
    }
  })

  test('journals asynchronous action failures with the original source trace', async () => {
    const view = await mountCenter()
    try {
      await view.act(async () => {
        view.store.getState().push({
          id: 'retryable-1',
          topic: 'application.notification',
          category: 'agent',
          severity: 'error',
          title: 'Agent run failed',
          origin: { kind: 'session', sessionId: 'LOCALIX-22', projectId: 'project-2' },
          actions: [
            {
              id: 'retry',
              label: 'Retry run',
              kind: 'callback',
              available: true,
              onClick: async () => {
                await Promise.resolve()
                throw new Error('provider unavailable')
              },
            },
          ],
        })
      })
      const trigger = view.host.querySelector<HTMLButtonElement>(
        'button[aria-label="Event Center, 3 unread"]',
      )
      await view.act(async () => {
        trigger!.click()
        await import('./NotificationCenter')
      })
      const expand = document.body.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand event: Agent run failed"]',
      )!
      await view.act(async () => expand.click())
      const retry = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.includes('Retry run'),
      )!
      await view.act(async () => {
        retry.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      const failure = view.store
        .getState()
        .entries.find((entry) => entry.title === 'Could not run “Retry run”')
      expect(failure).toMatchObject({
        severity: 'error',
        message: 'provider unavailable',
        origin: { kind: 'session', sessionId: 'LOCALIX-22', projectId: 'project-2' },
      })
      expect(
        failure?.trace?.some((step) => step.kind === 'event.action' && step.phase === 'failed'),
      ).toBe(true)
    } finally {
      await view.dispose()
    }
  })

  /**
   * "Details" is offered from inside modal dialogs (a vault item, a plugin's create form), so the
   * Event Center has to actually be usable while one is open. The z-order was already right
   * (`--z-popover: 250` over `--z-modal: 220`); what could not be settled by reading was Radix's
   * dialog focus trap and its `pointer-events: none` on the body. Both turn out to be answered by
   * Radix itself — the popover's own focus scope pauses the dialog's trap, and the popover content
   * paints `pointer-events: auto` over the locked body — and this test is here because either could
   * regress silently under a Radix upgrade. The control assertion proves the trap is live in the
   * first place; without it a passing test would mean nothing.
   */
  test('stays reachable when opened from inside a modal dialog', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { MemoryRouter } = await import('react-router')
    const { resetNotificationsForTests, useNotificationsStore } =
      await import('@/shared/lib/notifications/store')
    const { NotificationCenterLauncher } = await import('./NotificationCenterLauncher')
    const { openNotificationCenter } = await import('@/shared/lib/notificationCenterBus')
    const { Dialog, DialogContent, DialogHeader, DialogTitle } =
      await import('@localixai/kit/dialog')

    resetNotificationsForTests()
    useNotificationsStore.getState().push({
      id: 'blocked-1',
      topic: 'terminal.finished',
      category: 'terminal',
      severity: 'error',
      title: 'Build failed',
      origin: { kind: 'session', sessionId: 'LOCALIX-31', projectId: 'project-1' },
    })

    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <NotificationCenterLauncher />
            <Dialog open>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Vault item</DialogTitle>
                </DialogHeader>
                <button type="button" data-testid="in-dialog">
                  In dialog
                </button>
              </DialogContent>
            </Dialog>
          </MemoryRouter>,
        ),
      )

      // Control: the dialog really is trapping focus in this DOM.
      const trapped = document.createElement('button')
      document.body.append(trapped)
      trapped.focus()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(document.activeElement).not.toBe(trapped)
      trapped.remove()

      await act(async () => {
        openNotificationCenter('blocked-1')
        await import('./NotificationCenter')
      })
      const popover = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')!
      expect(popover).not.toBeNull()
      // The locked body is `pointer-events: none`; the popover exempts itself, so clicks land.
      expect(document.body.style.pointerEvents).toBe('none')
      expect(popover.style.pointerEvents).toBe('auto')
      // Nothing hid it from assistive tech either: the dialog only hides what existed when it opened.
      expect(popover.closest('[aria-hidden="true"]')).toBeNull()

      const row = popover.querySelector<HTMLButtonElement>('[data-event-row-trigger]')!
      await act(async () => {
        row.focus()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(popover.contains(document.activeElement)).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
      resetNotificationsForTests()
    }
  })
})
