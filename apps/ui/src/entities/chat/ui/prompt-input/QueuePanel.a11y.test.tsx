import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => teardown())

describe('QueuePanel accessibility', () => {
  test("says why a child's report is waiting instead of opening a turn", async () => {
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
              id: 'report-1',
              text: '[Delegated task finished] Draft notes',
              queueKind: 'wake',
              wakeSource: 'subagent',
              delivery: 'held',
            },
          ],
          onRemove: () => {},
          onClear: () => {},
        }),
      )
    })
    const hint = host.querySelector('[data-slot="workbench-list-row-action-fallback"]')!
    expect(hint.textContent).toBe('Waits for other reports')
    await act(async () => root.unmount())
  })

  test("names the list, the queue actions and each item's actions", async () => {
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

    const list = host.querySelector<HTMLElement>('[role="list"]')!
    const clear = host.querySelector<HTMLButtonElement>('button[aria-label="Clear queue"]')!
    const itemActions = host.querySelector<HTMLElement>('[data-slot="workbench-list-row-actions"]')!
    expect(list.getAttribute('aria-label')).toBe('Queued messages')
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(1)
    expect(clear.closest('[role="group"]')?.getAttribute('aria-label')).toBe('Queue actions')
    expect(list.contains(clear)).toBe(false)
    expect(itemActions.getAttribute('role')).toBe('group')
    expect(itemActions.getAttribute('aria-label')).toBe('Queued item 1 actions')
    expect(host.querySelector('button[aria-label^="Send now queued item 1:"]')).not.toBeNull()
    // Steering is named in the slot the actions take on hover, so the row never widens.
    const delivery = host.querySelector('[data-slot="workbench-list-row-action-fallback"]')!
    expect(delivery.textContent).toBe('Next tool')
    for (const action of Array.from(
      host.querySelectorAll<HTMLButtonElement>('button[data-size="icon-sm"]'),
    )) {
      expect(action.textContent).toBe('')
      expect(action.getAttribute('data-tooltip-trigger')).toBe('true')
    }

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

  test("an agent's turn shows who answers and cancels in one click; other wakes arm first", async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { QueuePanel } = await import('./QueuePanel')
    const host = document.createElement('div')
    const root = createRoot(host)
    const removed: string[] = []
    await act(async () => {
      root.render(
        React.createElement(QueuePanel, {
          queue: [
            {
              id: 'turn-1',
              text: 'gamer — waiting to answer',
              queueKind: 'wake',
              delivery: 'next-turn',
              agent: { name: 'gamer' },
            },
            { id: 'loop-1', text: 'Nightly check', queueKind: 'wake', delivery: 'next-turn' },
          ],
          onRemove: (item: { id: string }) => {
            removed.push(item.id)
          },
          onClear: () => {},
        }),
      )
    })
    expect(host.textContent).toContain('gamer')
    expect(host.textContent).not.toContain('Turn for')
    const cancel = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Cancel gamer\'s queued turn"]',
    )!
    await act(async () => cancel.click())
    expect(removed).toEqual(['turn-1'])

    const del = host.querySelector<HTMLButtonElement>('button[aria-label^="Delete queued item 2"]')!
    await act(async () => del.click())
    // Armed, not sent: the button now reads as a confirmation and shows it.
    expect(removed).toEqual(['turn-1'])
    expect(del.getAttribute('aria-pressed')).toBe('true')
    expect(del.querySelector('.lucide-check')).not.toBeNull()
    await act(async () => del.click())
    expect(removed).toEqual(['turn-1', 'loop-1'])
    await act(async () => root.unmount())
  })
})
