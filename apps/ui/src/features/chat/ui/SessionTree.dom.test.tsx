import { afterAll, beforeAll, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

test('the sidebar preserves nesting, folds independently and reveals selected or searched descendants', async () => {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useSessionTreeRenderer } = await import('./SessionTree')
  const { useSidebarSessions } = await import('../model/useSidebarSessions')
  const { useSidebarDisclosure } = await import('../model/useSidebarDisclosure')
  const session = (id: string, patch: Partial<UiSession> = {}) =>
    ({
      id,
      title: id,
      projectId: 'project',
      createdAt: 0,
      updatedAt: 0,
      sessionKind: 'chat',
      ...patch,
    }) as UiSession
  const rootSession = session('Main chat')
  const delegate = session('Delegate', { sessionKind: 'subagent', parentSessionId: rootSession.id })
  const review = session('Review', { sessionKind: 'subagent', parentSessionId: delegate.id })
  const other = session('Other chat')
  const extra = Array.from({ length: 6 }, (_, i) =>
    session(`Extra ${i}`, {
      sessionKind: 'job',
      parentSessionId: rootSession.id,
      updatedAt: 100 - i,
    }),
  )
  const sessions = [rootSession, delegate, review, other, ...extra]
  function Roster({ active, search }: { active: string; search: string }) {
    const disclosure = useSidebarDisclosure()
    const projection = useSidebarSessions({
      allSessions: sessions,
      activeProjectId: 'project',
      search,
      sortMode: 'recent',
      showArchived: false,
    })
    const renderTree = useSessionTreeRenderer({
      ...projection,
      activeSessionId: active,
      sortMode: 'recent',
      ...disclosure,
      onSelectSession: () => {},
      onDelete: () => {},
      onTogglePin: () => {},
    })
    return <>{projection.scopeSessions.flatMap(renderTree)}</>
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const paint = async (active: string, search = '') => {
    await React.act(async () => root.render(<Roster active={active} search={search} />))
  }
  const row = (id: string) => host.querySelector<HTMLElement>(`[role="button"][aria-label="${id}"]`)
  const fold = async (id: string) => {
    const button = row(id)?.parentElement?.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse sub-sessions"]',
    )
    expect(button).not.toBeNull()
    await React.act(async () => button!.click())
  }
  try {
    await paint(rootSession.id)
    expect(row(rootSession.id)?.querySelector('[data-slot="session-row-icon"]')).toBeNull()
    expect(row(other.id)?.querySelector('[data-slot="session-row-icon"]')).toBeNull()
    expect(row(delegate.id)).toBeNull() // Past the five-child preview.
    await paint(review.id)
    expect(row(delegate.id)?.querySelector('[aria-label="Worker"]')).not.toBeNull()
    expect(row(review.id)?.querySelector('[aria-label="Worker"]')).not.toBeNull()
    expect(row(review.id)?.getAttribute('aria-current')).toBe('true')
    expect(host.textContent?.match(/Show less/g)).toHaveLength(1)
    expect(row(delegate.id)?.parentElement?.style.paddingLeft).toBe('28px')
    expect(row(review.id)?.parentElement?.style.paddingLeft).toBe('48px')
    await fold(delegate.id)
    expect(row(review.id)).toBeNull()
    expect(row(delegate.id)?.parentElement?.textContent).toContain('1')
    expect(row(other.id)?.parentElement?.querySelector('[aria-expanded="true"]')).toBeNull()
    await paint(other.id, 'Review')
    expect(row(review.id)).not.toBeNull()
    expect(row('Extra 0')).toBeNull()
    expect(host.textContent).not.toContain('Show less')
    expect(row(other.id)).toBeNull()
    await paint(other.id)
    expect(row(review.id)).toBeNull() // Search does not overwrite an explicit fold.
    await paint(review.id)
    expect(row(review.id)).not.toBeNull() // Navigation reveals the path again.
  } finally {
    await React.act(async () => root.unmount())
    host.remove()
  }
})
