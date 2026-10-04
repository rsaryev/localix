import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'
import type { RosterRow } from './types'

// NOTE: `react-dom/client` and the hook under test are deliberately NOT statically imported — they
// must initialize AFTER registerDom() has installed a document. `check:architecture` enforces this.

let teardown: () => Promise<void>
let originalFetch: typeof fetch

/** More history than one page, so paging is a real state rather than a rounding case. */
const TOTAL = 694

/** Every roster query the hook issued, in order — the thing under test is what it ASKS for. */
let calls: { offset: number; limit: number }[] = []

function pageOf(offset: number, count: number): RosterRow[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `claude-code:session-${offset + index}`,
    provider: 'claude-code',
    nativeSessionId: `session-${offset + index}`,
    title: `Session ${offset + index}`,
    updatedAt: 1_700_000_000_000 - (offset + index) * 1000,
    sourcePath: `/Users/dev/.claude/projects/session-${offset + index}.jsonl`,
    state: 'done',
    authority: 'none',
  })) satisfies RosterRow[]
}

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let body: unknown = {}
    if (url.endsWith('/roster')) {
      if (typeof init?.body !== 'string') throw new TypeError('Expected a JSON request body')
      const parsed = JSON.parse(init.body) as {
        query?: { offset?: number; limit?: number }
      }
      const offset = parsed.query?.offset ?? 0
      const limit = parsed.query?.limit ?? 0
      calls.push({ offset, limit })
      const count = Math.max(0, Math.min(limit, TOTAL - offset))
      body = { items: pageOf(offset, count), withheld: TOTAL - offset - count, total: TOTAL }
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

beforeEach(() => {
  calls = []
  document.body.innerHTML = ''
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  await teardown()
})

/** A headless probe: this is a hook test, and a list would only add a virtualizer to reason about. */
async function mount(initial: { token: number; text: string }) {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { useRoster } = await import('./useRoster')

  let latest: ReturnType<typeof useRoster> | null = null
  function Probe({ token, text }: { token: number; text: string }) {
    latest = useRoster({ text, providers: [], states: [] }, token, true)
    return null
  }

  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = async () => {
    // The text filter is debounced, so a request only leaves after the timer.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250))
    })
  }
  const render = async (next: { token: number; text: string }) => {
    await act(async () => {
      root.render(React.createElement(Probe, next))
    })
    await settle()
  }
  await render(initial)
  return {
    root,
    act,
    render,
    settle,
    state: () => latest as NonNullable<typeof latest>,
  }
}

describe('a refresh is not a filter change', () => {
  test('a poll comes back with the depth the reader had, not the first page', async () => {
    // This effect re-runs for BOTH, and it used to respond identically: reset to offset 0 and
    // replace the rows with one page. So paging down and then waiting a single tick — five seconds
    // while a delegation runs — collapsed the list under the reader, scroll position included.
    const { root, act, render, state } = await mount({ token: 0, text: '' })
    const { ROSTER_PAGE_SIZE } = await import('./useRoster')
    expect(state().rows).toHaveLength(ROSTER_PAGE_SIZE)

    for (let page = 0; page < 2; page += 1) {
      await act(async () => {
        state().loadMore()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
    }
    const deep = 3 * ROSTER_PAGE_SIZE
    expect(state().rows).toHaveLength(deep)

    calls = []
    await render({ token: 1, text: '' })

    // ONE call, asking for everything already on screen — not a page, and not a page per page.
    expect(calls).toEqual([{ offset: 0, limit: deep }])
    expect(state().rows).toHaveLength(deep)

    await act(async () => {
      root.unmount()
    })
  })

  test('a filter change still starts over at a single page', async () => {
    // The other direction matters just as much: a new filter has no depth to preserve, and
    // re-asking for the previous one would make the first keystroke the most expensive call.
    const { root, act, render, state } = await mount({ token: 0, text: '' })
    const { ROSTER_PAGE_SIZE } = await import('./useRoster')

    await act(async () => {
      state().loadMore()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(state().rows).toHaveLength(2 * ROSTER_PAGE_SIZE)

    calls = []
    await render({ token: 0, text: 'parser' })

    expect(calls).toEqual([{ offset: 0, limit: ROSTER_PAGE_SIZE }])
    expect(state().rows).toHaveLength(ROSTER_PAGE_SIZE)

    await act(async () => {
      root.unmount()
    })
  })
})
