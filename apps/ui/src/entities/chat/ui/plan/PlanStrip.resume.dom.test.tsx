/**
 * The approved plan's two states: "Implementing" while anyone works on the conversation, and
 * "paused" with Continue when nobody does — the case the person hit after stopping a run, where
 * the strip offered only Open.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { ResumePoint, SessionPlan } from '@localixai/api/client'
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

const approved: SessionPlan = {
  id: 'plan-1',
  sessionId: 's1',
  version: 1,
  status: 'approved',
  title: 'Landing page',
  body: '1. Build it',
  authorAgentId: 'lead',
  approvedMode: 'default',
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: '2026-10-03T00:01:00.000Z',
  completedAt: null,
  completionSummary: null,
  filePath: '/work/.localix/plans/S1/v1.md',
  dismissedBy: null,
}

const point: ResumePoint = {
  key: 'plan:plan-1',
  kind: 'plan',
  title: 'Plan v1',
  detail: 'Landing page',
}

async function stubBackend(stubs: Record<string, (...args: never[]) => unknown>) {
  const { backendClient } = await import('@/shared/api/client')
  const target = backendClient as unknown as Record<string, unknown>
  const originals = Object.fromEntries(Object.keys(stubs).map((key) => [key, target[key]]))
  Object.assign(target, stubs)
  cleanups.push(() => Object.assign(target, originals))
}

async function render(session: Partial<UiSession>) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useChatStore } = await import('../../model/store')
  const { PlanStrip } = await import('./PlanStrip')
  await React.act(async () => {
    useChatStore.setState({
      allSessions: [
        {
          id: 's1',
          agents: [],
          rootSessionId: null,
          plans: [approved],
          isRunning: false,
          queuedMessages: [],
          pendingInteraction: null,
          ...session,
        } as unknown as UiSession,
      ],
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
  return { host, act: React.act, button, useChatStore }
}

describe('an approved plan nobody is working on', () => {
  test('is paused, and Continue is the suggested step', async () => {
    await stubBackend({ listComments: mock(async () => []) })
    const { host, button } = await render({ resumePoints: [point] })
    expect(host.textContent).toContain('Plan v1 paused')
    expect(button('Continue')).toBeDefined()
    expect(button('Open')).toBeDefined()
  })

  test('while the agent works it is "Implementing", with no Continue', async () => {
    await stubBackend({ listComments: mock(async () => []) })
    const { host, button } = await render({ resumePoints: [point], isRunning: true })
    expect(host.textContent).toContain('Implementing plan v1')
    expect(button('Continue')).toBeUndefined()
  })

  test('a turn waiting in the queue is work too: no Continue between Approve and the run', async () => {
    await stubBackend({ listComments: mock(async () => []) })
    const { button } = await render({
      resumePoints: [point],
      queuedMessages: [{ id: 'q1', kind: 'wake' }] as unknown as UiSession['queuedMessages'],
    })
    expect(button('Continue')).toBeUndefined()
  })

  test('no point from the server, no Continue — the agent may have finished it', async () => {
    await stubBackend({ listComments: mock(async () => []) })
    const { host, button } = await render({ resumePoints: [] })
    expect(host.textContent).toContain('Implementing plan v1')
    expect(button('Continue')).toBeUndefined()
  })

  test('Continue asks the server and the answer replaces the points', async () => {
    const resumeWork = mock(async () => ({ points: [point], wake: 'delivered' }))
    await stubBackend({ listComments: mock(async () => []), resumeWork })
    const { act, button } = await render({ resumePoints: [point] })
    await act(async () => {
      button('Continue')!.click()
      await settle()
    })
    expect(resumeWork).toHaveBeenCalledWith('s1', 'plan:plan-1')
  })

  test('a point gone meanwhile removes Continue and says so transiently', async () => {
    const { toast } = await import('@/shared/lib/notify')
    const said: string[] = []
    const info = toast.info
    toast.info = ((message: string) => (said.push(message), 1)) as typeof toast.info
    cleanups.push(() => Object.assign(toast, { info }))
    const resumeWork = mock(async () => ({ points: [], gone: { message: 'gone' } }))
    await stubBackend({ listComments: mock(async () => []), resumeWork })
    const { act, button } = await render({ resumePoints: [point] })
    await act(async () => {
      button('Continue')!.click()
      await settle()
    })
    expect(said).toEqual(['Plan v1 no longer needs continuing'])
    expect(button('Continue')).toBeUndefined()
  })
})
