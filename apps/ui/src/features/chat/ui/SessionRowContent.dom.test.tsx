import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { AttentionItem } from '@localixai/api/client'
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

const item = (kind: AttentionItem['kind'], key: string): AttentionItem => ({
  key,
  kind,
  sessionId: 's1',
  at: '2026-10-03T10:00:00.000Z',
  title: key,
  subject: {},
})

async function badge(items: AttentionItem[], session: Partial<UiSession> = {}) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { applyAttentionRoster, resetAttentionForTests } = await import('../model/attention/store')
  const { RowBadge } = await import('./SessionRowContent')
  await React.act(async () => applyAttentionRoster(items))
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(<RowBadge session={{ id: 's1', ...session } as UiSession} />)
  })
  cleanups.push(async () => {
    await React.act(async () => {
      root.unmount()
      resetAttentionForTests()
    })
    host.remove()
  })
  return host.querySelector<HTMLElement>('[aria-label]')?.getAttribute('aria-label') ?? null
}

describe('the sidebar row badge', () => {
  test('shows the most pressing item from the shared roster', async () => {
    expect(await badge([item('question', 'q1'), item('plan', 'p1')])).toBe(
      'A plan is waiting for your review',
    )
    expect(await badge([item('plan', 'p1'), item('interaction', 'h1')])).toBe(
      'The agent is waiting for your input',
    )
  })

  test('counts queued questions in its label', async () => {
    expect(await badge([item('question', 'q1'), item('question', 'q2')])).toBe(
      'The agent asked you 2 questions',
    )
  })

  test('falls back to the unread dot when nothing waits', async () => {
    expect(await badge([], { isUnread: true })).toBe('Unread conversation')
  })
})
