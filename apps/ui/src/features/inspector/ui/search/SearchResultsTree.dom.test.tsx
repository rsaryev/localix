import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { FileContentMatch } from '@/shared/api/contracts'
import { registerDom } from '@localixai/kit/testing/dom'
import { SearchResultsTree } from './SearchResultsTree'
import { buildSearchTree } from './searchTree'
import type { ContentSearch } from './useContentSearch'

let teardown: () => Promise<void>
let restoreRect: (() => void) | null = null

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // happy-dom has no layout, so every element reports a height of 0 — and the virtualizer
  // sizes its viewport by `clientHeight` and each row by `offsetHeight`. Give the scroll
  // container a viewport and give every row a height derived from what it actually
  // rendered (20px per rendered line), which is exactly the variability real context
  // lines introduce.
  const keys = ['offsetHeight', 'clientHeight'] as const
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key))
  const height: PropertyDescriptor = {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.dataset.index !== undefined) return this.querySelectorAll('button').length * 20
      if (this.classList.contains('overflow-auto')) return 240
      return 0
    },
  }
  for (const key of keys) Object.defineProperty(HTMLElement.prototype, key, height)
  restoreRect = () => {
    keys.forEach((key, index) => {
      const original = originals[index]
      if (original) Object.defineProperty(HTMLElement.prototype, key, original)
      else Reflect.deleteProperty(HTMLElement.prototype, key)
    })
  }
})
afterAll(async () => {
  restoreRect?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/** 1000 matches across 20 files in 5 folders — the backend's own result cap. */
function largeCorpus(context: number): FileContentMatch[] {
  return Array.from({ length: 1000 }, (_, index) => ({
    path: `apps/ui/src/mod-${Math.floor(index / 200)}/file-${index % 20}.ts`,
    line: index + 1,
    lineText: `const needle${index} = value(${index})`,
    matchStart: 6,
    matchEnd: 12,
    ...(context
      ? {
          before: Array.from({ length: context }, (_, k) => `before ${k}`),
          after: Array.from({ length: context }, (_, k) => `after ${k}`),
        }
      : {}),
  }))
}

function search(
  matches: FileContentMatch[],
  overrides: Partial<ContentSearch> = {},
): ContentSearch {
  return {
    matches,
    tree: buildSearchTree(matches),
    collapsed: new Set<string>(),
    root: '/workspace',
    loading: false,
    toggleNode: () => {},
    previewFor: () => null,
    ...overrides,
  } as ContentSearch
}

async function mount(cs: ContentSearch) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(<SearchResultsTree cs={cs} />)
    await Promise.resolve()
  })
  return {
    host,
    act,
    rerender: (next: ContentSearch) =>
      act(async () => {
        root.render(<SearchResultsTree cs={next} />)
        await Promise.resolve()
      }),
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('virtualized content-search results', () => {
  test('mounts a bounded window instead of every match in a capped result set', async () => {
    const view = await mount(search(largeCorpus(0)))
    try {
      const rows = view.host.querySelectorAll('[data-index]')
      const buttons = view.host.querySelectorAll('button')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThan(60)
      // Unvirtualized this rendered 1000 match buttons plus 25 headers.
      expect(buttons.length).toBeLessThan(80)
      // Every mounted row belongs to the flat model, in order, starting at the top.
      const indexes = [...rows].map((row) => Number((row as HTMLElement).dataset.index))
      expect(indexes[0]).toBe(0)
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
    } finally {
      await view.unmount()
    }
  })

  test('context lines stay inside their match row and give rows different heights', async () => {
    const view = await mount(search(largeCorpus(2)))
    try {
      const rows = [...view.host.querySelectorAll<HTMLElement>('[data-index]')]
      const matchRows = rows.filter((row) => row.querySelectorAll('button').length > 1)
      expect(matchRows.length).toBeGreaterThan(0)
      // 2 before + match + 2 after = five clickable lines in one virtual row.
      expect(matchRows[0]?.querySelectorAll('button').length).toBe(5)
      expect(view.host.textContent).toContain('before 0')
      expect(view.host.textContent).toContain('after 1')

      // Dynamic measurement, not a fixed row height: the tall match rows and the
      // short header rows must be laid out at their own measured sizes.
      const offsets = rows
        .map((row) => ({
          top: Number(/translateY\((-?[\d.]+)px\)/.exec(row.style.transform)?.[1] ?? Number.NaN),
          lines: row.querySelectorAll('button').length,
        }))
        .sort((a, b) => a.top - b.top)
      const deltas = offsets
        .slice(0, -1)
        .map((row, i) => ({ measured: offsets[i + 1]!.top - row.top, lines: row.lines }))
      expect(deltas.some((d) => d.lines === 5)).toBe(true)
      for (const delta of deltas) expect(delta.measured).toBe(delta.lines * 20)
      expect(new Set(deltas.map((d) => d.measured)).size).toBeGreaterThan(1)
    } finally {
      await view.unmount()
    }
  })

  test('collapsing a file removes its match rows and keeps the header clickable', async () => {
    const toggled: string[] = []
    const matches = largeCorpus(0)
    const view = await mount(search(matches, { toggleNode: (key) => toggled.push(key) }))
    try {
      const header = view.host.querySelector<HTMLElement>('[data-search-node]')
      expect(header).not.toBeNull()
      await view.act(async () => {
        header!.click()
        await Promise.resolve()
      })
      expect(toggled).toEqual([header!.dataset.searchNode!])

      const firstFile = [...view.host.querySelectorAll<HTMLElement>('[data-search-node]')].find(
        (el) => el.dataset.searchNode!.endsWith('.ts'),
      )!
      const filePath = firstFile.dataset.searchNode!
      const before = view.host.querySelectorAll(`[title^="${filePath}:"]`).length
      expect(before).toBeGreaterThan(0)
      await view.rerender(search(matches, { collapsed: new Set([filePath]) }))
      expect(view.host.querySelectorAll(`[title^="${filePath}:"]`).length).toBe(0)
      expect(view.host.querySelector(`[data-search-node="${filePath}"]`)).not.toBeNull()
    } finally {
      await view.unmount()
    }
  })

  test('replace preview renders on the mounted match rows', async () => {
    const view = await mount(search(largeCorpus(0), { previewFor: () => 'REPLACED' }))
    try {
      expect(view.host.textContent).toContain('REPLACED')
      expect(view.host.querySelector('.line-through')).not.toBeNull()
    } finally {
      await view.unmount()
    }
  })

  test('a picked match opens in the chat the results were searched in, or not at all', async () => {
    const { inspector } = await import('@/shared/lib/inspectorBus')
    const open = spyOn(inspector, 'openFile').mockImplementation(() => {})
    const matches = largeCorpus(0).slice(0, 1)
    const owned = await mount(search(matches, { sessionId: 'search-owner' }))
    try {
      const line = owned.host.querySelector<HTMLElement>(`[title="${matches[0]!.path}:1"]`)!
      await owned.act(async () => line.click())
      expect(open.mock.calls).toEqual([
        [{ sessionId: 'search-owner', path: `/workspace/${matches[0]!.path}`, line: 1 }],
      ])
    } finally {
      await owned.unmount()
    }
    // No session: the click used to fall through to the chat on screen; now it opens nothing.
    const orphan = await mount(search(matches, { sessionId: null }))
    try {
      const line = orphan.host.querySelector<HTMLElement>(`[title="${matches[0]!.path}:1"]`)!
      await orphan.act(async () => line.click())
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      await orphan.unmount()
      open.mockRestore()
    }
  })

  test('the searching placeholder replaces the row window, not the scroll container', async () => {
    const view = await mount(search([], { loading: true }))
    try {
      expect(view.host.querySelectorAll('[data-index]').length).toBe(0)
      expect(view.host.textContent).toContain('Searching')
      expect(view.host.querySelector('.overflow-auto')).not.toBeNull()
    } finally {
      await view.unmount()
    }
  })
})
