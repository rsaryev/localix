import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { CommentView, SessionPlan } from '@localixai/api/client'
import type { UiSession } from '@/shared/api/contracts'
import type { PlanDraftInfo } from '@/shared/api/plans-client'
import type { WorkItem } from '@/shared/lib/workItem'

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
  status: 'completed',
  title: 'Cache layer',
  body: 'Add a cache in front of the reads.',
  authorAgentId: 'lead',
  approvedMode: 'default',
  completionSummary: 'Cache shipped behind a flag.',
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: '2026-10-03T01:00:00.000Z',
  completedAt: '2026-10-03T02:00:00.000Z',
  filePath: '/work/.localix/plans/S1/v2.md',
  dismissedBy: null,
  ...over,
})

const draftOf = (changed: boolean): PlanDraftInfo => ({
  path: '/work/.localix/plans/S1/PLAN.md',
  exists: true,
  changed,
})

async function render(
  plans: SessionPlan[],
  {
    draft = draftOf(false),
    reopenPlan = mock(async () => undefined),
    planId = undefined as string | undefined,
    comments = [] as CommentView[],
  } = {},
) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { backendClient } = await import('@/shared/api/client')
  const target = backendClient as unknown as Record<string, unknown>
  const stubs: Record<string, unknown> = {
    listComments: mock(async (scope: string) => comments.filter((c) => c.scope === scope)),
    // The tab re-asks for the draft when shown; the versions come from the store below.
    listPlans: mock(async () => ({ plans, draft })),
    reopenPlan,
  }
  const originals = Object.fromEntries(Object.keys(stubs).map((key) => [key, target[key]]))
  Object.assign(target, stubs)
  cleanups.push(() => {
    Object.assign(target, originals)
  })
  const { useChatStore } = await import('../../model/store')
  const { resetPlanCommentsForTest } = await import('../../model/planComments')
  const { PlanView } = await import('./PlanView')
  await React.act(async () => {
    resetPlanCommentsForTest()
    useChatStore.setState({
      allSessions: [{ id: 's1', agents: [], rootSessionId: null, plans } as unknown as UiSession],
    })
  })
  const item = {
    id: 'plan:s1',
    payload: { ownerId: 's1', planId: planId ?? plans[0]!.id },
  } as unknown as WorkItem
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(<PlanView item={item} />)
    await settle()
  })
  cleanups.push(async () => {
    await React.act(async () => root.unmount())
    host.remove()
  })
  return host
}

const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((candidate) =>
    candidate.textContent?.trim().startsWith(text),
  )

describe('the plan tab — the draft and a version set aside', () => {
  test('a draft that moved on after the newest version is said, quietly', async () => {
    const latest = plan({ status: 'presented', completionSummary: null })
    const changed = await render([latest], { draft: draftOf(true) })
    expect(changed.querySelector('[aria-label="Draft changed"]')?.textContent).toBe(
      'The draft changed after v2 and has not been presented yet.',
    )
    const same = await render([latest], { draft: draftOf(false) })
    expect(same.querySelector('[aria-label="Draft changed"]')).toBeNull()
  })

  test('Back to review is offered for the newest version set aside, and reopens it', async () => {
    const reopenPlan = mock(async () => undefined)
    const host = await render([plan({ status: 'dismissed', completionSummary: null })], {
      reopenPlan,
    })
    const { act } = await import('react')
    await act(async () => {
      button(host, 'Back to review')?.click()
      await settle()
    })
    expect(reopenPlan).toHaveBeenCalledWith('s1', 'plan-2')
  })

  test('not for an older one, nor for a version that is not set aside', async () => {
    // v2 is shown, but v3 came after it: the server would refuse to reopen v2.
    const older = await render(
      [
        plan({ id: 'plan-3', version: 3, status: 'presented', completionSummary: null }),
        plan({ status: 'dismissed', completionSummary: null }),
      ],
      { planId: 'plan-2' },
    )
    expect(older.textContent).toContain('v2 · dismissed')
    expect(button(older, 'Back to review')).toBeUndefined()
    const waiting = await render([plan({ status: 'presented', completionSummary: null })])
    expect(button(waiting, 'Back to review')).toBeUndefined()
  })
})

describe('the plan tab', () => {
  test('a completed version opens on the summary the agent reported', async () => {
    const host = await render([plan()])
    const note = host.querySelector('[aria-label="Completion summary"]')
    expect(note?.textContent).toContain('Completed plan v2')
    expect(note?.textContent).toContain('Cache shipped behind a flag.')
  })

  test('a presented version can be approved from its header; a decided one cannot', async () => {
    const waiting = await render([plan({ status: 'presented', completionSummary: null })])
    expect(waiting.querySelector('button[aria-label="Approve plan"]')).not.toBeNull()
    const decided = await render([plan({ status: 'approved', completionSummary: null })])
    expect(decided.querySelector('button[aria-label="Approve plan"]')).toBeNull()
  })

  test('the header suggests Approve, or the comments to send once there are open ones', async () => {
    const marked = (element: Element | null | undefined) =>
      element?.getAttribute('data-recommended') === 'true'
    const presented = plan({ status: 'presented', completionSummary: null })

    const clean = await render([presented])
    expect(marked(clean.querySelector('button[aria-label="Approve plan"]'))).toBe(true)
    expect(clean.querySelectorAll('[data-recommended]').length).toBe(1)

    const open: CommentView = {
      id: 'c1',
      scope: 'plan:plan-2',
      anchor: { quote: 'Add a cache in front of the reads.' },
      body: 'Which cache?',
      status: 'open',
      createdAt: '2026-10-03T00:00:00.000Z',
      updatedAt: '2026-10-03T00:00:00.000Z',
    }
    const commented = await render([presented], { comments: [open] })
    expect(marked(commented.querySelector('button[aria-label="Approve plan"]'))).toBe(false)
    // The count pill is the way to Request changes, so it carries the mark instead.
    expect(marked(commented.querySelector('button[aria-label="Review 1 comment"]'))).toBe(true)
    expect(commented.querySelectorAll('[data-recommended]').length).toBe(1)

    // A decided version suggests nothing, and Back to review is a recovery, never the next step.
    const setAside = await render([plan({ status: 'dismissed', completionSummary: null })])
    expect(button(setAside, 'Back to review')).toBeDefined()
    expect(setAside.querySelectorAll('[data-recommended]').length).toBe(0)
  })

  test('a version that is not completed shows no summary', async () => {
    const host = await render([plan({ status: 'approved', completionSummary: null })])
    expect(host.querySelector('[aria-label="Completion summary"]')).toBeNull()
  })
})
