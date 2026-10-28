import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { DirEntry } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'

import { FileTreeEntries } from './FileTreeEntries'
import { fileTreeEntryRows, flattenFileTreeRows } from './fileTreeRows'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

describe('virtualized FileTreeEntries', () => {
  test('mounts a bounded far viewport plus the one pinned Tab stop', async () => {
    const React = await import('react')
    const { act } = React
    const { createRoot } = await import('react-dom/client')
    const entries: DirEntry[] = Array.from({ length: 5_000 }, (_, index) => ({
      name: `file-${index}.ts`,
      type: 'file',
    }))
    const rows = flattenFileTreeRows({
      root: '/p',
      childrenByPath: { '/p': entries },
      truncatedByPath: {},
      expanded: new Set(),
      loading: new Set(),
      edit: null,
      filter: null,
      compactEnabled: false,
    })
    const entryRows = fileTreeEntryRows(rows)

    function Harness() {
      const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null)
      // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual returns non-memoizable functions by design.
      const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: rows.length,
        getScrollElement: () => scrollEl,
        estimateSize: () => 24,
        overscan: 12,
        getItemKey: (index) => rows[index]?.key ?? index,
        initialRect: { width: 320, height: 240 },
        initialOffset: 4_980 * 24,
        observeElementRect: (_instance, callback) => {
          callback({ width: 320, height: 240 })
          return () => {}
        },
        observeElementOffset: (_instance, callback) => {
          callback(4_980 * 24, false)
          return () => {}
        },
        measureElement: () => 24,
        scrollToFn: () => {},
        rangeExtractor: (range) => {
          const indexes = defaultRangeExtractor(range)
          if (!indexes.includes(0)) indexes.push(0)
          return indexes.sort((a, b) => a - b)
        },
      })
      return (
        <div ref={setScrollEl} role="tree" style={{ height: 240, overflow: 'auto' }}>
          <FileTreeEntries
            rows={rows}
            entryOrder={entryRows}
            virtualizer={virtualizer}
            sessionId={null}
            activeFilePath={null}
            editError={null}
            filterQuery=""
            selected={new Map()}
            clipboard={null}
            decorations={{
              decorationFor: () => undefined,
              directoryHasDecorations: () => false,
            }}
            compareSelectedPath={null}
            isSessionCurrent={() => true}
            dnd={
              {
                dragOverKey: null,
                beginDrag: () => {},
                endDrag: () => {},
                dropTarget: () => ({}),
              } as never
            }
            matchesKey={() => false}
            rowOps={{} as never}
            tabIndexFor={(path) => (path === '/p/file-0.ts' ? 0 : -1)}
            selectRow={() => {}}
            doToggleDir={() => {}}
            expandCompactAt={() => {}}
            startCreate={() => {}}
            submitEdit={() => {}}
            cancelEdit={() => {}}
          />
        </div>
      )
    }

    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(<Harness />)
        await Promise.resolve()
      })

      const mounted = [...host.querySelectorAll<HTMLElement>('[data-tree-path]')]
      expect(mounted.length).toBeGreaterThan(10)
      expect(mounted.length).toBeLessThan(50)
      expect(mounted.some((row) => row.dataset.treePath === '/p/file-0.ts')).toBe(true)
      expect(mounted.some((row) => Number(row.dataset.treePath?.match(/\d+/)?.[0]) >= 4_970)).toBe(
        true,
      )
      const tabStops = mounted.filter((row) => row.tabIndex === 0)
      expect(tabStops).toHaveLength(1)
      expect(tabStops[0]?.dataset.treePath).toBe('/p/file-0.ts')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
