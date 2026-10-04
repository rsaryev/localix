import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { UiSession } from '@/shared/api/contracts'
import { useChatStore } from '@/features/chat/model/store'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(() => teardown())

describe('RuntimeSessionsPanel lifecycle rows', () => {
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
