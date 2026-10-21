import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { useGridStore } from '@/entities/workspace-grid/model'
import { inspector } from '@/shared/lib/inspectorBus'
import { registerDom } from '@localixai/kit/testing/dom'
import { openFileInGrid, useRecentFiles } from '@/shared/lib/recentFiles'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('recent file ownership', () => {
  test('quick-open recents are isolated by session scope', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    const originalScope = useGridStore.getState().activeScope
    const open = spyOn(inspector, 'openFile').mockImplementation(() => {})
    let current: string[] = []

    function Harness({ sessionId }: { sessionId: string }) {
      current = useRecentFiles(sessionId)
      return null
    }

    try {
      // The grid's focused scope is B for BOTH opens: the recents follow the session the request
      // names, never whichever chat happens to be on screen.
      useGridStore.getState().setActiveScope('recent-session-b')
      openFileInGrid({ sessionId: 'recent-session-a', path: '/workspace-a/a.ts' })
      openFileInGrid({ sessionId: 'recent-session-b', path: '/workspace-b/b.ts' })

      await act(async () => root.render(<Harness sessionId="recent-session-a" />))
      expect(current).toEqual(['/workspace-a/a.ts'])

      await act(async () => root.render(<Harness sessionId="recent-session-b" />))
      expect(current).toEqual(['/workspace-b/b.ts'])
    } finally {
      await act(async () => root.unmount())
      useGridStore.getState().setActiveScope(originalScope)
      open.mockRestore()
    }
  })
})
