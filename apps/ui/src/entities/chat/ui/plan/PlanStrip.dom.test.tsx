import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CommentView, SessionPlan } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'

let teardown: () => Promise<void>
const cleanups: Array<() => unknown> = []

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.()
})

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const plan = (over: Partial<SessionPlan> = {}): SessionPlan => ({
  id: 'plan-2',
  sessionId: 's1',
  version: 2,
  status: 'presented',
  title: 'Cache layer',
  body: 'Add a cache in front of the reads.',
  authorAgentId: 'lead',
  approvedMode: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: null,
  completedAt: null,
  completionSummary: null,
  filePath: '/work/.localix/plans/S1/v2.md',
  dismissedBy: null,
  ...over,
})

const comment = (over: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  scope: 'plan:plan-2',
  anchor: { quote: 'Add a cache in front of the reads.' },
  body: 'Which cache?',
  status: 'open',
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  ...over,
})

/** Swap backend methods for the test and put them back after it. */
async function stubBackend(stubs: Record<string, (...args: never[]) => unknown>) {
  const { backendClient } = await import('@/shared/api/client')
  const target = backendClient as unknown as Record<string, unknown>
  const originals = Object.fromEntries(Object.keys(stubs).map((key) => [key, target[key]]))
  Object.assign(target, stubs)
  cleanups.push(() => Object.assign(target, originals))
}

async function render(
  plans: SessionPlan[],
  agents: Array<{ agentId: string; handle: string }> = [],
) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useChatStore } = await import('../../model/store')
  const { resetPlanCommentsForTest } = await import('../../model/planComments')
  const { PlanStrip } = await import('./PlanStrip')
  // Inside act: a strip from an earlier render in the same test is still mounted and re-renders.
  await React.act(async () => {
    resetPlanCommentsForTest()
    useChatStore.setState({
      allSessions: [{ id: 's1', agents, rootSessionId: null, plans } as unknown as UiSession],
    })
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(<PlanStrip sessionId="s1" isFocused={false} />)
    await settle()
  })
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
  })
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
      candidate.textContent?.trim().startsWith(text),
    )
  return { host, act: React.act, button }
}

describe('the plan strip', () => {
  test('shows a presented plan with its open comments, and nothing for a superseded one', async () => {
    // Only the presented version has comments, so there is nothing to carry over from v1.
    const listComments = mock(async (scope: string) => (scope === 'plan:plan-2' ? [comment()] : []))
    await stubBackend({ listComments })
    const shown = await render([plan(), plan({ id: 'plan-1', version: 1, status: 'superseded' })])
    expect(shown.host.textContent).toContain('Plan v2')
    expect(shown.host.textContent).toContain('Cache layer')
    expect(shown.host.textContent).toContain('1 comment')

    const hidden = await render([plan({ status: 'superseded' })])
    expect(hidden.host.textContent).toBe('')
  })

  test('Request changes is disabled until the version has an open comment', async () => {
    await stubBackend({ listComments: mock(async () => [comment({ status: 'sent' })]) })
    const { button } = await render([plan()])
    expect(button('Request changes')?.disabled).toBe(true)
  })

  test('Request changes sends the open comments of the presented version', async () => {
    const requestPlanChanges = mock(async () => ({ plan: plan(), wake: 'delivered', comments: 1 }))
    await stubBackend({ listComments: mock(async () => [comment()]), requestPlanChanges })
    const { act, button } = await render([plan()])
    expect(button('Request changes')?.disabled).toBe(false)
    await act(async () => {
      button('Request changes')?.click()
      await settle()
    })
    expect(requestPlanChanges).toHaveBeenCalledWith('s1', 'plan-2', undefined)
  })

  test('the expected step is suggested: Approve without open comments, Request changes with', async () => {
    const recommended = (element: Element | null | undefined) =>
      element?.getAttribute('data-recommended') === 'true' &&
      element.querySelector('.lx-border-beam') !== null

    await stubBackend({ listComments: mock(async () => []) })
    const clean = await render([plan()])
    const approve = clean.host.querySelector('button[aria-label="Approve plan"]')
    expect(recommended(approve)).toBe(true)
    expect(recommended(clean.button('Request changes'))).toBe(false)
    // One per surface: nothing else in the strip carries the mark.
    expect(clean.host.querySelectorAll('[data-recommended]').length).toBe(1)

    await stubBackend({ listComments: mock(async () => [comment()]) })
    const commented = await render([plan()])
    expect(recommended(commented.button('Request changes'))).toBe(true)
    expect(recommended(commented.host.querySelector('button[aria-label="Approve plan"]'))).toBe(
      false,
    )
    expect(commented.host.querySelectorAll('[data-recommended]').length).toBe(1)
  })

  test('Approve opens the menu and approves in the mode chosen, naming nobody', async () => {
    const approvePlan = mock(async () => ({
      plan: plan({ status: 'approved' }),
      wake: 'delivered',
    }))
    await stubBackend({ listComments: mock(async () => []), approvePlan })
    const { host, act } = await render([plan()], [{ agentId: 'lead', handle: 'lead' }])
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Approve plan"]')!
    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle()
    })
    const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu.textContent).toContain('Approve plan v2')
    const rowIn = (role: string, name: string) =>
      [...document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find(
        (element) => element.querySelector('.truncate')?.textContent === name,
      )
    // A one-agent chat: the mode and the act, nothing to choose an agent from.
    expect(rowIn('menuitem', 'Agent')).toBeUndefined()
    for (const [role, name] of [
      ['menuitem', 'Mode'],
      ['menuitemradio', 'Bypass'],
      ['menuitem', 'Approve'],
    ] as const) {
      await act(async () => {
        rowIn(role, name)!.click()
        await settle()
      })
    }
    // A one-agent chat offers no agent choice; the conversation's only agent answers.
    expect(approvePlan).toHaveBeenCalledWith('s1', 'plan-2', 'bypass', undefined)
  })

  test('a stale Approve answered 409 corrects the strip and says so transiently, never as an error', async () => {
    // The list had missed the frame that approved v2; each click was a red journal error.
    const { toast } = await import('@/shared/lib/notify')
    const said: string[] = []
    const info = toast.info
    const error = toast.error
    toast.info = ((message: string) => (said.push(`info ${message}`), 1)) as typeof toast.info
    toast.error = ((message: string) => (said.push(`error ${message}`), 1)) as typeof toast.error
    cleanups.push(() => Object.assign(toast, { info, error }))
    const approved = plan({ status: 'approved', approvedMode: 'autonomous' })
    const approvePlan = mock(async () => ({
      plans: [approved],
      conflict: { code: 'plan_decided', message: 'Plan v2 is already approved' },
    }))
    await stubBackend({ listComments: mock(async () => []), approvePlan })
    const { host, act } = await render([plan()])
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Approve plan"]')!
    await act(async () => {
      trigger.focus()
      trigger.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle()
    })
    const approve = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.querySelector('.truncate')?.textContent === 'Approve',
    )!
    await act(async () => {
      approve.click()
      await settle()
    })
    expect(said).toEqual(['info Plan v2 was already approved'])
    expect(host.textContent).toContain('Implementing plan v2')
    expect(host.querySelector('button[aria-label="Approve plan"]')).toBeNull()
  })

  test('an approved plan shrinks to an "Implementing" reminder that reopens it', async () => {
    await stubBackend({ listComments: mock(async () => []) })
    const { host, button } = await render([plan({ status: 'approved', approvedMode: 'default' })])
    expect(host.textContent).toContain('Implementing plan v2')
    // The plan is the conversation's: the reminder names no agent as its implementer.
    expect(host.textContent).not.toContain('Implementing plan v2 ·')
    expect(host.textContent).toContain('Cache layer')
    expect(button('Request changes')).toBeUndefined()
    expect(button('Open')).toBeDefined()
  })

  test('the newest version set aside keeps one quiet row that brings it back', async () => {
    // The defect: leaving Plan mode dismissed v2, the strip went blank, and the only way back
    // was the agent retyping the plan as v3.
    const reopenPlan = mock(async () => undefined)
    await stubBackend({ listComments: mock(async () => []), reopenPlan })
    const { host, act, button } = await render([plan({ status: 'dismissed' })])
    expect(host.textContent).toContain('Plan v2 set aside')
    expect(button('Approve')).toBeUndefined()
    // A recovery, not the expected next step: it is offered, never suggested.
    expect(button('Back to review')?.hasAttribute('data-recommended')).toBe(false)
    expect(host.querySelector('.lx-border-beam')).toBeNull()
    await act(async () => {
      button('Back to review')?.click()
      await settle()
    })
    expect(reopenPlan).toHaveBeenCalledWith('s1', 'plan-2')
  })

  test('an older set-aside version is history: nothing newer means nothing to bring back', async () => {
    const { resetSetAsideRowsForTest } = await import('./PlanSetAside')
    resetSetAsideRowsForTest()
    await stubBackend({ listComments: mock(async () => []) })
    const newer = await render([
      plan({ id: 'plan-3', version: 3, status: 'superseded' }),
      plan({ status: 'dismissed' }),
    ])
    expect(newer.host.textContent).toBe('')

    // Closing the row hides it for that version; it does not come back on a remount.
    const shown = await render([plan({ status: 'dismissed' })])
    const close = shown.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide this reminder"]',
    )
    await shown.act(async () => {
      close?.click()
      await settle()
    })
    expect(shown.host.textContent).toBe('')
    const again = await render([plan({ status: 'dismissed' })])
    expect(again.host.textContent).toBe('')
    resetSetAsideRowsForTest()
  })

  test('a completed plan leaves the strip empty — the notice carries the completion', async () => {
    await stubBackend({ listComments: mock(async () => []) })
    const { host } = await render([
      plan({ status: 'completed', approvedMode: 'default' }),
      plan({ id: 'plan-1', version: 1, status: 'superseded' }),
    ])
    expect(host.textContent).toBe('')
  })
})
