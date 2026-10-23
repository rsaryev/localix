import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('warm-hidden DevOps viewer', () => {
  test('log virtualization disconnects while its work item is parked', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { LiveLogViewer } = await import('./LiveLogViewer')

    const originalResizeObserver = window.ResizeObserver
    let created = 0
    let disconnected = 0
    class CountingResizeObserver {
      constructor(_callback: ResizeObserverCallback) {
        created += 1
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected += 1
      }
    }
    window.ResizeObserver = CountingResizeObserver as unknown as typeof ResizeObserver

    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <LiveLogViewer
            subject="web-1"
            content={'INFO ready\nWARN retrying'}
            emptyLabel="No logs"
            ariaLabel="Test logs"
            live
            onLiveChange={() => {}}
          />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Surface visible={false} />))
      expect(created).toBe(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBeGreaterThan(0)

      const visibleObserverCount = created
      await act(async () => root.render(<Surface visible={false} />))
      expect(disconnected).toBeGreaterThan(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBeGreaterThan(visibleObserverCount)
    } finally {
      await act(async () => root.unmount())
      window.ResizeObserver = originalResizeObserver
    }
  })
})
