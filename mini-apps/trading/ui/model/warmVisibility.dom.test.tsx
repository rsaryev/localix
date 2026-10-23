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

describe('warm-hidden trading auxiliary work', () => {
  test('chart box observation disconnects while parked and measures on resume', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act, useRef } = React
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { useVisibleResizeObserver } = await import('./useVisibleResizeObserver')

    const OriginalResizeObserver = globalThis.ResizeObserver
    let created = 0
    let disconnected = 0
    let measured = 0
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
    globalThis.ResizeObserver = CountingResizeObserver as unknown as typeof ResizeObserver

    function Box() {
      const ref = useRef<HTMLDivElement>(null)
      useVisibleResizeObserver(ref, () => {
        measured += 1
      })
      return <div ref={ref} />
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Box />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Surface visible={false} />))
      expect(created).toBe(0)
      expect(measured).toBe(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(1)
      expect(measured).toBe(1)

      await act(async () => root.render(<Surface visible={false} />))
      expect(disconnected).toBe(1)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(2)
      expect(measured).toBe(2)
    } finally {
      await act(async () => root.unmount())
      globalThis.ResizeObserver = OriginalResizeObserver
    }
  })

  // The concentration-history test that stood here exercised `useConcentration`, a hook that
  // computed position concentration from the ACCOUNT book. `e550f0cb1` stripped this mini app to
  // research and deleted it, but the test kept importing it — so `apps/ui` type-check has been RED
  // ever since (TS2307, a module that does not exist). The warm-hidden INVARIANT it covered is
  // still covered, by the two tests around it: work parks while hidden and resumes on show.

  test('one-second chart clocks release their interval while parked', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { useSecondTick } = await import('./useSecondTick')

    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    let created = 0
    let cleared = 0
    globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      created += 1
      return originalSetInterval(handler, timeout, ...args)
    }) as typeof setInterval
    globalThis.clearInterval = ((timer: ReturnType<typeof setInterval>) => {
      cleared += 1
      return originalClearInterval(timer)
    }) as typeof clearInterval

    function Clock() {
      useSecondTick(true)
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Clock />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Surface visible={false} />))
      expect(created).toBe(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(1)

      await act(async () => root.render(<Surface visible={false} />))
      expect(cleared).toBe(1)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(2)
    } finally {
      await act(async () => root.unmount())
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
    }
  })
})
