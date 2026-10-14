import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('QueuePanel accessibility', () => {
  test('removes collapsed controls from keyboard navigation and labels item actions', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { QueuePanel } = await import('./QueuePanel')
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => {
      root.render(
        React.createElement(QueuePanel, {
          queue: [
            {
              id: 'queued-1',
              text: 'Run the focused regression test',
              queueKind: 'user',
              delivery: 'next-tool',
            },
          ],
          onRemove: () => {},
          onSendNow: () => {},
          onClear: () => {},
        }),
      )
    })

    const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!
    const listId = toggle.getAttribute('aria-controls')!
    const list = host.querySelector<HTMLElement>(`#${CSS.escape(listId)}`)!
    const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear queue"]')!
    const itemActions = host.querySelector<HTMLElement>('[data-slot="workbench-list-row-actions"]')!
    expect(list.getAttribute('role')).toBe('list')
    expect(list.getAttribute('aria-label')).toBe('Queued messages')
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(1)
    expect(toggle.contains(clear)).toBe(false)
    expect(clear.closest('[data-slot="collapsible-strip-actions"]')).not.toBeNull()
    expect(itemActions.getAttribute('role')).toBe('group')
    expect(itemActions.getAttribute('aria-label')).toBe('Queued item 1 actions')
    expect(host.querySelector('button[aria-label^="Send now queued item 1:"]')).not.toBeNull()
    const delivery = host.querySelector('[data-slot="workbench-list-row-meta"]')!
    expect(delivery.textContent).toBe('')
    expect(delivery.className).toContain('h-6 items-center')
    expect(delivery.querySelector('[role="img"][aria-label="Next tool"]')).not.toBeNull()
    expect(delivery.querySelector('svg')?.getAttribute('class')).toContain('size-3.5')
    const send = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Send now queued item 1:"]',
    )!
    expect(send.className).toContain('size-[var(--chrome-control-sm)]')
    expect(send.querySelector('svg')?.getAttribute('class')).toContain('size-3.5')
    expect(host.querySelector('button[aria-label="Next tool"]')).toBeNull()
    for (const action of Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-size="icon"]'),
    )) {
      expect(action.textContent).toBe('')
      expect(action.getAttribute('title')).toBeNull()
      expect(action.getAttribute('data-tooltip-trigger')).toBe('true')
    }

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(list.getAttribute('aria-hidden')).toBe('true')
    expect(list.hasAttribute('inert')).toBe(true)
    expect(host.querySelector('[aria-label="Clear queue"]')).toBeNull()

    await act(async () => root.unmount())
  })

  test('locks queue actions while send-now is in flight and restores them afterwards', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { QueuePanel } = await import('./QueuePanel')
    const host = document.createElement('div')
    const root = createRoot(host)
    let resolveSend!: () => void
    const pending = new Promise<void>((resolve) => {
      resolveSend = resolve
    })
    let sends = 0
    await act(async () => {
      root.render(
        React.createElement(QueuePanel, {
          queue: [{ id: 'u1', text: 'Please continue', queueKind: 'user', delivery: 'next-turn' }],
          onSendNow: () => {
            sends += 1
            return pending.then(() => ({ message: 'Accepted — starting the queued turn…' }))
          },
          onRemove: () => {},
          onClear: () => {},
        }),
      )
    })
    const send = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Send now queued item"]',
    )!
    expect(host.querySelector('[role="img"][aria-label="Next turn"]')).not.toBeNull()
    expect(host.querySelector('button[aria-label="Next turn"]')).toBeNull()
    await act(async () => {
      send.click()
      send.click()
    })
    const pendingSend = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Send now queued item"]',
    )!
    const pendingRemove = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Return to input"]',
    )!
    const pendingClear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear queue"]')!
    expect(sends).toBe(1)
    expect(pendingSend.disabled).toBe(true)
    expect(pendingRemove.disabled).toBe(true)
    expect(pendingClear.disabled).toBe(true)
    expect(host.querySelector('[role="listitem"]')?.getAttribute('aria-busy')).toBe('true')
    await act(async () => {
      resolveSend()
      await pending
    })
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label^="Send now queued item"]')?.disabled,
    ).toBe(false)
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label^="Return to input"]')?.disabled,
    ).toBe(false)
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Clear queue"]')?.disabled,
    ).toBe(false)
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'Accepted — starting the queued turn…',
    )
    await act(async () => root.unmount())
  })

  test('requires an explicit second action before destructive queue deletion', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { QueuePanel } = await import('./QueuePanel')
    const host = document.createElement('div')
    const root = createRoot(host)
    let clears = 0
    let removes = 0
    await act(async () => {
      root.render(
        React.createElement(QueuePanel, {
          queue: [
            {
              id: 'wake-1',
              text: 'Background job bg-1 finished',
              queueKind: 'wake',
              delivery: 'next-turn',
            },
          ],
          onRemove: () => {
            removes += 1
          },
          onClear: () => {
            clears += 1
          },
        }),
      )
    })

    const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear queue"]')!
    await act(async () => clear.click())
    expect(clears).toBe(0)
    expect(clear.getAttribute('aria-label')).toBe('Confirm clear all 1 queued items')
    await act(async () => clear.click())
    expect(clears).toBe(1)

    const remove = host.querySelector<HTMLButtonElement>('button[aria-label^="Delete queued"]')!
    await act(async () => remove.click())
    expect(removes).toBe(0)
    expect(remove.getAttribute('aria-label')).toStartWith('Confirm delete queued item 1:')
    await act(async () => remove.click())
    expect(removes).toBe(1)

    await act(async () => root.unmount())
  })

  test('re-arms clear confirmation when reconnect changes the server queue', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { QueuePanel } = await import('./QueuePanel')
    const host = document.createElement('div')
    const root = createRoot(host)
    let clears = 0
    const renderQueue = async (ids: string[]) => {
      await act(async () => {
        root.render(
          React.createElement(QueuePanel, {
            queue: ids.map((id) => ({
              id,
              text: `Queued message ${id}`,
              queueKind: 'user' as const,
              delivery: 'next-turn' as const,
            })),
            onRemove: () => {},
            onClear: () => {
              clears += 1
            },
          }),
        )
      })
    }

    await renderQueue(['q1'])
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Clear queue"]')!.click(),
    )
    expect(host.querySelector('[aria-label="Confirm clear all 1 queued items"]')).not.toBeNull()

    await renderQueue(['q1', 'q2'])
    const reset = host.querySelector<HTMLButtonElement>('[aria-label="Clear queue"]')!
    expect(reset).not.toBeNull()
    await act(async () => reset.click())
    expect(clears).toBe(0)
    expect(host.querySelector('[aria-label="Confirm clear all 2 queued items"]')).not.toBeNull()
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Confirm clear all 2 queued items"]')!
        .click(),
    )
    expect(clears).toBe(1)

    await act(async () => root.unmount())
  })
})
