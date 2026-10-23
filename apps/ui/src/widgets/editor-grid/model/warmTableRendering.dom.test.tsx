import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'
import type { TableColumn, TableRow } from '@localixai/dataview'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('warm-hidden table rendering', () => {
  test('chart observation waits for selection and disconnects while parked', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { ChartView } = await import('@localixai/mini-app-sdk/ui/charts')

    const OriginalResizeObserver = globalThis.ResizeObserver
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
    globalThis.ResizeObserver = CountingResizeObserver as unknown as typeof ResizeObserver

    const columns: TableColumn[] = [
      { id: 'label', title: 'Label', type: 'text' },
      { id: 'value', title: 'Value', type: 'number' },
    ]
    const rows: TableRow[] = [{ label: 'one', value: 1 }]

    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <ChartView columns={columns} rows={rows} spec={{ kind: 'bar', x: 'label', y: 'value' }} />
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
      expect(disconnected).toBe(1)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBe(2)
    } finally {
      await act(async () => root.unmount())
      globalThis.ResizeObserver = OriginalResizeObserver
    }
  })

  test('grid virtualization and paging wait for selection', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { TableGrid } = await import('@/features/inspector/ui/table/TableGrid')

    const OriginalResizeObserver = window.ResizeObserver
    let created = 0
    let disconnected = 0
    let reachedEnd = 0
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

    const columns: TableColumn[] = [{ id: 'value', title: 'Value', type: 'text' }]
    const rows: TableRow[] = Array.from({ length: 5 }, (_, value) => ({ value }))

    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <TableGrid
            columns={columns}
            rows={rows}
            total={10}
            onToggleSort={() => {}}
            onReachEnd={() => {
              reachedEnd += 1
            }}
          />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<Surface visible={false} />))
      expect(created).toBe(0)
      expect(reachedEnd).toBe(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBeGreaterThan(0)
      expect(reachedEnd).toBe(1)

      const visibleObserverCount = created
      await act(async () => root.render(<Surface visible={false} />))
      expect(disconnected).toBeGreaterThan(0)

      await act(async () => root.render(<Surface visible />))
      expect(created).toBeGreaterThan(visibleObserverCount)
      expect(reachedEnd).toBe(2)
    } finally {
      await act(async () => root.unmount())
      window.ResizeObserver = OriginalResizeObserver
    }
  })
})
