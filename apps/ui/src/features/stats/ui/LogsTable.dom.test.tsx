import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
let restoreHeight: (() => void) | null = null

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // happy-dom has no layout: every element reports offsetHeight 0, and that single
  // value is what the virtualizer reads for both the viewport and each row. Give the
  // scroll box the real `max-h-96` viewport and every request row its single-line height.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement): number {
      if (this.dataset.index !== undefined) return 36
      if (this.classList.contains('overflow-auto')) return 384
      return 0
    },
  })
  restoreHeight = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original)
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
  }
})
afterAll(async () => {
  restoreHeight?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

/**
 * The usage log pages 50 rows at a time with no ceiling, into a 384-pixel viewport.
 * Every loaded row used to stay in the DOM, so a long triage session accumulated
 * thousands of 13-cell rows behind ~10 visible ones. The body now mounts a window
 * plus two spacer rows; these tests pin the bound, the preserved scroll height, and
 * the behaviours the window must not cost us (paging sentinel, row interaction).
 */
function logRow(i: number) {
  return {
    messageId: `m-${i}`,
    createdAt: new Date(1_700_000_000_000 + i * 1_000).toISOString(),
    modelId: 'claude-opus-5',
    providerId: 'anthropic',
    sessionId: `s-${i}`,
    sessionTitle: `Session ${i}`,
    totalTokens: 100 + i,
    inputTokens: 60,
    outputTokens: 40,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0.01,
    costSource: 'actual',
    durationMs: 1_200,
    usageKind: 'byok',
    finishReason: 'stop',
  } as never
}

async function mount(rowCount: number, hasMore = true) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { LogsTable } = await import('./LogsTable')

  const opened: string[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(LogsTable, {
        rows: Array.from({ length: rowCount }, (_, i) => logRow(i)),
        isLoading: false,
        isLoadingMore: false,
        hasMore,
        onLoadMore: () => {},
        onOpenSession: (id: string) => opened.push(id),
      }),
    )
  })
  return {
    host,
    opened,
    act,
    rows: () => host.querySelectorAll('tbody tr[data-index]'),
    spacers: () => host.querySelectorAll('tbody tr[aria-hidden]'),
    cleanup: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

describe('LogsTable mounts a bounded window', () => {
  test('500 loaded rows do not become 500 DOM rows', async () => {
    const h = await mount(500)
    // MUTATION: render `rows.map(...)` again → 500 mounted rows → red.
    expect(h.rows().length).toBeLessThan(100)
    expect(h.rows().length).toBeGreaterThan(0)
    await h.cleanup()
  })

  test('a short log is not windowed away — every row is still mounted', async () => {
    const h = await mount(12)
    expect(h.rows().length).toBe(12)
    // Nothing is hidden, so no spacer is needed above or below.
    expect(h.spacers().length).toBe(0)
    await h.cleanup()
  })

  test('spacer rows preserve the scroll height of the unmounted rows', async () => {
    const h = await mount(500)
    const spacers = [...h.spacers()] as HTMLElement[]
    const padding = spacers.reduce((sum, el) => sum + Number.parseFloat(el.style.height || '0'), 0)
    const mountedHeight = h.rows().length * 36
    // Total table body height still describes all 500 rows: that is what keeps the
    // paging sentinel at the true tail instead of one viewport from the top.
    expect(padding + mountedHeight).toBeGreaterThanOrEqual(500 * 36)
    await h.cleanup()
  })

  test('the paging sentinel is still rendered while more pages exist', async () => {
    const h = await mount(500)
    expect(h.host.querySelectorAll('div.h-1').length).toBe(1)
    expect(h.host.textContent).toContain('Scroll for more')
    await h.cleanup()
  })

  test('mounted rows keep their session interaction', async () => {
    const h = await mount(500)
    const button = h.host.querySelector<HTMLButtonElement>('tbody tr[data-index] button')!
    await h.act(async () => {
      button.click()
    })
    expect(h.opened).toEqual(['s-0'])
    await h.cleanup()
  })
})
