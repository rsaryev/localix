import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerDom } from '@localixai/kit/testing'
import type { RosterRow } from './model/types'

// NOTE: `react-dom/client` is deliberately NOT statically imported — it must initialize AFTER
// registerDom() has installed a document. `check:architecture` enforces this for every DOM test.

let teardown: () => Promise<void>
let originalFetch: typeof fetch
let originalWebSocket: typeof WebSocket
let originalOffsets: { prop: string; descriptor: PropertyDescriptor | undefined }[] = []

/** The bound the fake backend reports: 200 rows returned out of 694 matches. */
const TOTAL = 694
const PAGE = 200

/** Every call the panel makes, so a poll can be counted rather than described. */
let requests = 0

/** happy-dom exposes `visibilityState` as a prototype getter; a test needs to drive it. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

function fakeRows(count: number): RosterRow[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `claude-code:session-${index}`,
    provider: 'claude-code',
    nativeSessionId: `session-${index}`,
    title: `Session ${index}`,
    cwd: '/Users/dev/code/localix/packages/api',
    updatedAt: 1_700_000_000_000 - index * 1000,
    sourcePath: `/Users/dev/.claude/projects/session-${index}.jsonl`,
    state: index === 0 ? 'working' : 'done',
    authority: index === 0 ? 'screen-manifest' : 'none',
  })) satisfies RosterRow[]
}

beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // happy-dom runs no layout engine: every element reports offsetWidth/offsetHeight 0, and that
  // is exactly what TanStack Virtual measures the scroll viewport with (`getRect`). Without a box
  // the visible window is empty and the list renders nothing. Seed one, and restore the original
  // descriptors afterwards — these prototypes outlive a single registerDom() in a shared process.
  originalOffsets = ['offsetWidth', 'offsetHeight'].map((prop) => ({
    prop,
    descriptor: Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop),
  }))
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 720,
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 640,
  })
  // The panel follows the roster's push stream over the host's realtime socket. There is no server
  // here, and happy-dom's socket reports its failed connect as an unhandled error event; a socket
  // that never opens leaves the panel on its own cadence, which is what these cases measure.
  originalWebSocket = globalThis.WebSocket
  globalThis.WebSocket = class {
    readyState = 0
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  } as unknown as typeof WebSocket
  originalFetch = globalThis.fetch
  globalThis.fetch = (async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests += 1
    const body = url.endsWith('/providers')
      ? {
          providers: [
            {
              provider: 'claude-code',
              displayName: 'Claude Code',
              roots: [{ path: '/Users/dev/.claude/projects', exists: true }],
              sessionCount: TOTAL,
              verified: true,
            },
            {
              provider: 'codex',
              displayName: 'Codex',
              roots: [{ path: '/Users/dev/.codex/sessions', exists: false }],
              sessionCount: 0,
              verified: false,
              error: 'history root not found',
            },
          ],
        }
      : url.endsWith('/roster')
        ? { items: fakeRows(PAGE), withheld: TOTAL - PAGE, total: TOTAL }
        : url.endsWith('/stats')
          ? {
              sessions: 12,
              messages: 84,
              usage: {
                inputTokens: 420_000,
                cachedInputTokens: 1_200_000,
                cacheWriteTokens: 80_000,
                outputTokens: 75_000,
                reasoningTokens: 12_000,
                totalTokens: 1_775_000,
                requests: 46,
              },
              usageSessions: 11,
              projects: 3,
              firstAt: Date.parse('2026-07-01T00:00:00Z'),
              lastAt: Date.parse('2026-08-03T00:00:00Z'),
              medianDurationMs: 1_500_000,
              byProvider: [
                {
                  key: 'claude-code',
                  sessions: 12,
                  updatedAt: Date.now(),
                  usage: {
                    inputTokens: 420_000,
                    cachedInputTokens: 1_200_000,
                    cacheWriteTokens: 80_000,
                    outputTokens: 75_000,
                    reasoningTokens: 12_000,
                    totalTokens: 1_775_000,
                    requests: 46,
                  },
                },
              ],
              byProject: [
                {
                  key: '/Users/dev/code/localix',
                  sessions: 12,
                  updatedAt: Date.now(),
                  usage: {
                    inputTokens: 420_000,
                    cachedInputTokens: 1_200_000,
                    cacheWriteTokens: 80_000,
                    outputTokens: 75_000,
                    reasoningTokens: 12_000,
                    totalTokens: 1_775_000,
                    requests: 46,
                  },
                },
              ],
              topSessions: [
                {
                  key: 'claude-code:heavy-1',
                  label: 'Optimise the animation',
                  sessions: 1,
                  updatedAt: Date.now(),
                  usage: {
                    inputTokens: 420_000,
                    cachedInputTokens: 1_200_000,
                    cacheWriteTokens: 80_000,
                    outputTokens: 75_000,
                    reasoningTokens: 12_000,
                    totalTokens: 1_775_000,
                    requests: 46,
                  },
                },
              ],
              byModel: [
                {
                  key: 'claude-opus-4-8',
                  sessions: 11,
                  updatedAt: Date.now(),
                  usage: {
                    inputTokens: 420_000,
                    cachedInputTokens: 1_200_000,
                    cacheWriteTokens: 80_000,
                    outputTokens: 75_000,
                    reasoningTokens: 12_000,
                    totalTokens: 1_775_000,
                    requests: 46,
                  },
                },
              ],
              byDay: [
                {
                  key: '2026-08-03',
                  sessions: 12,
                  updatedAt: 0,
                  usage: {
                    inputTokens: 420_000,
                    cachedInputTokens: 1_200_000,
                    cacheWriteTokens: 80_000,
                    outputTokens: 75_000,
                    reasoningTokens: 12_000,
                    totalTokens: 1_775_000,
                    requests: 46,
                  },
                },
              ],
              activeDays: 1,
              bucketDays: 1,
            }
          : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
})

afterEach(() => {
  document.body.innerHTML = ''
})

afterAll(async () => {
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
  for (const { prop, descriptor } of originalOffsets) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
  }
  await teardown()
})

async function renderPanel() {
  const React = await import('react')
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { MemoryRouter } = await import('react-router')
  const { ExternalAgentsPanel } = await import('./ExternalAgentsPanel')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/global/current-session'] },
        React.createElement(ExternalAgentsPanel),
      ),
    )
  })
  // The text filter is debounced, so the first roster request only fires after the timer.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
  })
  return { host, root, act }
}

describe('External Agents roster', () => {
  test('virtualizes a large roster and states what it withheld', async () => {
    const { host, root, act } = await renderPanel()

    const list = host.querySelector('[role="list"]')
    expect(list).not.toBeNull()

    // Virtualization invariant: a 200-row page must NOT produce 200 row elements. Only the
    // visible window plus overscan is mounted, which is the whole reason this list scales.
    const rendered = host.querySelectorAll('[role="listitem"]')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(PAGE)

    // The bound is reported verbatim — a truncated list must never look complete.
    expect(host.textContent).toContain(`Showing ${PAGE} of ${TOTAL}.`)
    expect(host.textContent).toContain(`${TOTAL - PAGE} not shown — narrow the filter.`)

    await act(async () => {
      root.unmount()
    })
  })

  test('reports a provider whose roots are missing instead of showing zero rows', async () => {
    const { host, root, act } = await renderPanel()

    expect(host.textContent).toContain('Claude Code')
    expect(host.textContent).toContain('Codex')
    // An unverified adapter is labelled rather than presented as authoritative.
    expect(host.textContent).toContain('unverified')

    await act(async () => {
      root.unmount()
    })
  })

  test('returning to a backgrounded window takes a reading instead of waiting out the tick', async () => {
    // The roster used to drive itself from a hand-rolled `setTimeout` gated only on our own tab
    // strip, so a window behind another application kept scanning four history roots — and a tick
    // is two requests, since the providers list and the roster both re-read. Watching a delegation
    // from another app is this plugin's normal case. The shared poller owns that gating (and is
    // tested where it lives); what has to hold HERE is that the panel is wired into it, which the
    // read-on-return below can only be true of.
    const { root, act } = await renderPanel()
    const afterMount = requests
    expect(afterMount).toBeGreaterThan(0)

    await act(async () => {
      setVisibility('hidden')
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    await act(async () => {
      setVisibility('visible')
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    // A cold machine polls every five minutes; coming back must not mean waiting one out.
    expect(requests).toBeGreaterThan(afterMount)

    await act(async () => {
      root.unmount()
    })
    setVisibility('visible')
  })

  test('offers the row itself as the session, with no extra controls', async () => {
    const { host, root, act } = await renderPanel()

    const row = host.querySelector('[role="listitem"]')
    expect(row?.getAttribute('draggable')).toBe('true')
    // The row addresses its session by the canonical resource URI — the same one the backend's
    // resource provider mints — so a drop, a chip click and a tool call all name one session.
    expect(row?.getAttribute('data-resource-uri')).toBe(
      'localix://resource/external-agent/claude-code/session-0',
    )
    // The row IS the affordance: dragging it carries the session, clicking it opens the session.
    // No per-row Link/Unlink button, and no second control repeating what the row already does.
    expect(host.querySelector('button[aria-label^="Link"]')).toBeNull()
    expect(host.textContent).not.toContain('Unlink')
    const importButton = host.querySelector('button[aria-label^="Import"]')
    expect(importButton).not.toBeNull()
    // `Download` pointed out of the product and looked like export. The dedicated import glyph
    // points into a boundary and matches the action named by the accessible label.
    expect(importButton?.querySelector('svg.lucide-import')).not.toBeNull()

    await act(async () => {
      root.unmount()
    })
  })

  test('stats lead with measured consumption rather than another session count', async () => {
    const { host, root, act } = await renderPanel()
    const statsButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Stats',
    )
    expect(statsButton).toBeDefined()

    await act(async () => {
      statsButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    // NOT "Total tokens": that name belongs to our own usage screen, where it means fresh input
    // plus output. This figure includes cache re-reads, and on real history the two differ by 12x
    // to 506x — by a different factor per provider, so a reader cannot correct for it.
    expect(host.textContent).toContain('Tokens processed')
    expect(host.textContent).not.toContain('Total tokens')
    expect(host.textContent).toContain('1.77M')
    // The tooltip carries the comparable figure, so the bridge to the other screen is in reach
    // rather than left as arithmetic over four tiles.
    const processed = [...host.querySelectorAll('[title]')].find((node) =>
      node.getAttribute('title')?.includes('cache re-reads included'),
    )
    expect(processed?.getAttribute('title')).toContain('495.0k')
    expect(host.textContent).toContain('Cache reuse')
    expect(host.textContent).toContain('71%')
    expect(host.textContent).toContain('Token consumption over time')
    expect(host.textContent).toContain('By model')
    expect(host.textContent).toContain('claude-opus-4-8')
    expect(host.textContent).toContain('Usage is provider-reported for 11 of 12 sessions')
    // The project axis is the one capped distribution, and the cap has to say so: the fixture
    // reports 3 distinct projects and one bar. Measured on a real local history it was 12 of 20, with the
    // "Projects" tile stating the larger number beside a chart that could not explain the gap.
    // The title names the POPULATION, not a shown count: `DistributionChart` draws at most eight
    // rows and discloses the rest itself, so "top 12 of 20" beside eight bars was one number too many.
    expect(host.textContent).toContain('By project, of 3 distinct')
    expect(host.textContent).not.toContain('top 1 of 3')
    // Every other axis aggregates: on real history 10 sessions of 212 hold 53% of all tokens, which
    // the project axis hides by folding 151 of them into one bar.
    expect(host.textContent).toContain('Heaviest sessions of 11 measured')
    // The TITLE is what a reader recognises, and asserting the key is what let the bars ship
    // labelled `claude-code:cc71d515-fee9-…`: `DistributionChart` has no `detail` slot, so the label
    // has to come through `labelKey`. The key stays reachable as the bar's hover title.
    expect(host.textContent).toContain('Optimise the animation')
    const heavyBar = [...host.querySelectorAll('[title]')].find(
      (node) => node.getAttribute('title') === 'claude-code:heavy-1',
    )
    expect(heavyBar).toBeDefined()

    await act(async () => {
      root.unmount()
    })
  })
})
