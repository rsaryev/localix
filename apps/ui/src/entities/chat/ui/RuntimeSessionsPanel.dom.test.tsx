import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/entities/chat/model/store'
import { backendClient } from '@/shared/api/client'

let teardown: () => Promise<void>
const originalRows = backendClient.getSubagentRows
beforeAll(() => {
  // No plugin status line here: the panel reads the rows once and draws its own.
  backendClient.getSubagentRows = (async () => ({
    active: false,
    rows: [],
  })) as typeof backendClient.getSubagentRows
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => {
  backendClient.getSubagentRows = originalRows
  return teardown()
})

describe('RuntimeSessionsPanel lifecycle rows', () => {
  test('folds a branch independently and keeps completed names and status dots readable', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { RuntimeSessionsPanel } = await import('./RuntimeSessionsPanel')
    const originalSessions = useChatStore.getState().allSessions
    const session = (id: string, title: string, parentSessionId: string, createdAt: number) =>
      ({
        id,
        title,
        parentSessionId,
        createdAt,
        rootSessionId: 'root',
        sessionKind: 'subagent',
        runtimeStatus: 'completed',
      }) as UiSession
    useChatStore.setState({
      allSessions: [
        session('parent', 'Implement', 'root', 2),
        session('child', 'Review', 'parent', 3),
        session('grandchild', 'Check accessibility', 'child', 4),
        session('other', 'Research', 'root', 1),
      ],
    })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const onSelect = mock((_id: string) => {})
    const button = (label: string) =>
      host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    const click = async (label: string) => {
      expect(button(label)).not.toBeNull()
      await React.act(async () => button(label)!.click())
    }
    try {
      await React.act(async () => {
        root.render(
          <RuntimeSessionsPanel scopeRootId="root" activeSessionId="child" onSelect={onSelect} />,
        )
      })
      await click('Show agent sessions')
      expect(host.querySelectorAll('[data-slot="workbench-list-row"]')).toHaveLength(4)
      const childTrigger = button('Open Review')!
      expect(childTrigger.getAttribute('aria-current')).toBe('page')
      expect(childTrigger.textContent).toBe('Review')
      expect(childTrigger.closest('[data-slot="workbench-list-row"]')?.classList).not.toContain(
        'opacity-70',
      )
      await click('Collapse Review sub-sessions')
      expect(button('Open Check accessibility')).toBeNull()
      await click('Collapse Implement sub-sessions')
      expect(button('Open Review')).toBeNull()
      expect(button('Open Research')).not.toBeNull()
      expect(button('Expand Implement sub-sessions')?.getAttribute('aria-expanded')).toBe('false')
      expect(onSelect).not.toHaveBeenCalled()
      await click('Expand Implement sub-sessions')
      expect(button('Open Review')).not.toBeNull()
      expect(button('Open Check accessibility')).toBeNull()
      await click('Expand Review sub-sessions')
      await click('Open Check accessibility')
      expect(onSelect).toHaveBeenCalledWith('grandchild')
    } finally {
      await React.act(async () => root.unmount())
      host.remove()
      useChatStore.setState({ allSessions: originalSessions })
    }
  })

  test('keeps navigation and the icon-only stop action as semantic siblings', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const { backendClient } = await import('@/shared/api/client')
    const { RuntimeSessionsPanel } = await import('./RuntimeSessionsPanel')
    const originalSessions = useChatStore.getState().allSessions
    const originalStop = backendClient.stop.bind(backendClient)
    const stop = mock(async (_sessionId: string) => true)
    const onSelect = mock((_sessionId: string) => {})
    const worker = {
      id: 'worker-1',
      title: 'Review worker',
      sessionKind: 'subagent',
      runtimeStatus: 'running',
      rootSessionId: 'root-1',
      parentSessionId: 'root-1',
      createdAt: 1,
    } as UiSession
    useChatStore.setState({ allSessions: [worker] })
    backendClient.stop = stop
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    try {
      await act(async () => {
        root.render(
          <RuntimeSessionsPanel
            scopeRootId="root-1"
            activeSessionId="worker-1"
            onSelect={onSelect}
          />,
        )
      })

      const row = host.querySelector<HTMLElement>('[data-slot="workbench-list-row"]')
      const trigger = row?.querySelector<HTMLButtonElement>(
        '[data-slot="workbench-list-row-trigger"]',
      )
      const stopAction = row?.querySelector<HTMLButtonElement>(
        'button[aria-label="Stop Review worker"]',
      )

      expect(row?.dataset.density).toBe('dense')
      expect(row?.dataset.active).toBe('true')
      expect(trigger?.getAttribute('aria-current')).toBe('page')
      expect(trigger?.contains(stopAction ?? null)).toBe(false)
      expect(stopAction?.textContent).toBe('')
      expect(stopAction?.getAttribute('data-slot')).toBe('button')
      expect(stopAction?.getAttribute('data-size')).toBe('icon')
      expect(stopAction?.getAttribute('data-tooltip-trigger')).toBe('true')
      expect(stopAction?.getAttribute('title')).toBeNull()

      await act(async () => trigger?.click())
      expect(onSelect).toHaveBeenCalledWith('worker-1')

      await act(async () => stopAction?.click())
      expect(stop).toHaveBeenCalledWith('worker-1')
    } finally {
      await act(async () => root.unmount())
      host.remove()
      useChatStore.setState({ allSessions: originalSessions })
      backendClient.stop = originalStop
    }
  })
})
