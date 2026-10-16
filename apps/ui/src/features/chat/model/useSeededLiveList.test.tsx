import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing/dom'

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  // React needs this flag for `act()` to flush effects/microtasks synchronously in a test env.
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  // React's scheduler reads `window` inside the callback it queues for the final unmount.
  // Let that callback drain BEFORE happy-dom's globals go away, or it throws between tests.
  await new Promise((r) => setTimeout(r, 0))
  await teardown()
})

/** A `fetchList` whose every call is held open, so a test decides exactly when — and in what
 *  order relative to a live event — each seed settles. Stable identity, as the hook requires. */
function heldFetch() {
  const calls: Array<{ sid: string; settle: (list: string[]) => void; fail: () => void }> = []
  const fetchList = (sid: string) =>
    new Promise<string[]>((resolve, reject) => {
      calls.push({ sid, settle: resolve, fail: () => reject(new Error('offline')) })
    })
  return { calls, fetchList }
}

/** Mounts the hook in a real React root and exposes its render log + a prop-updating rerender. */
async function mountList(
  fetchList: (sid: string) => Promise<string[]>,
  initial: { sessionId: string | null; live?: string[] },
) {
  const React = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const { useSeededLiveList } = await import('./useSeededLiveList')

  /** One entry per render PASS of the hook's owner — this is the setState-in-effect probe. */
  const renders: string[][] = []
  let latest: { list: string[]; reload: () => void } | null = null

  function Harness({ sessionId, live }: { sessionId: string | null; live?: string[] }) {
    const view = useSeededLiveList(sessionId, live, fetchList)
    renders.push(view.list)
    latest = view
    return null
  }

  const root = createRoot(document.createElement('div'))
  let props = initial
  const render = async (next: Partial<typeof initial> = {}) => {
    props = { ...props, ...next }
    await act(async () => {
      root.render(<Harness sessionId={props.sessionId} live={props.live} />)
    })
  }
  await render()

  return {
    renders,
    list: () => latest!.list,
    reload: () =>
      act(async () => {
        latest!.reload()
      }),
    render,
    unmount: () =>
      act(async () => {
        root.unmount()
      }),
    act,
  }
}

/** Real elapsed time, so the CURRENT (clock-stamped) implementation cannot tie on `Date.now()`'s
 *  millisecond resolution. The identity-based rewrite does not need it — it is here so these
 *  characterization tests describe the behavior of BOTH versions. */
const tick = () => new Promise((r) => setTimeout(r, 3))

describe('useSeededLiveList — which source wins', () => {
  test('with no live channel, the fetched seed is the list', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1' })
    expect(h.list()).toEqual([])
    expect(calls).toHaveLength(1)

    await h.act(async () => {
      calls[0].settle(['a'])
    })
    expect(h.list()).toEqual(['a'])
    await h.unmount()
  })

  test('a live list wins before any seed has landed', async () => {
    const { fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    expect(h.list()).toEqual(['L']) // the in-flight fetch must not blank a list we already have
    await h.unmount()
  })

  test('a seed that settles AFTER the live list it saw wins (the fetch is authoritative)', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    await tick()
    await h.act(async () => {
      calls[0].settle(['S'])
    })
    expect(h.list()).toEqual(['S'])
    await h.unmount()
  })

  test('a live event that arrives AFTER the seed settled wins', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    await tick()
    await h.act(async () => {
      calls[0].settle(['S'])
    })
    await tick()
    await h.render({ live: ['L2'] })
    expect(h.list()).toEqual(['L2'])
    await h.unmount()
  })

  test('an explicit reload beats the live list it superseded', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    await tick()
    await h.act(async () => {
      calls[0].settle(['S'])
    })
    await h.render({ live: ['L2'] })
    expect(h.list()).toEqual(['L2'])

    // The user acted on the list; the server streams nothing back, so the caller reloads.
    await tick()
    await h.reload()
    await h.act(async () => {
      calls[1].settle(['S2'])
    })
    expect(h.list()).toEqual(['S2'])
    await h.unmount()
  })

  test("a session switch derives to empty — the previous session's seed never shows", async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1' })
    await h.act(async () => {
      calls[0].settle(['a'])
    })
    expect(h.list()).toEqual(['a'])

    await h.render({ sessionId: 's2' })
    expect(h.list()).toEqual([]) // s1's list must not flash while s2's fetch is in flight
    expect(calls[1]?.sid).toBe('s2')
    await h.unmount()
  })

  test('a stale in-flight fetch for the previous session cannot land on the new one', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1' })
    await h.render({ sessionId: 's2' })

    await h.act(async () => {
      calls[0].settle(['from-s1'])
    }) // late arrival, superseded
    expect(h.list()).toEqual([])
    await h.act(async () => {
      calls[1].settle(['from-s2'])
    })
    expect(h.list()).toEqual(['from-s2'])
    await h.unmount()
  })

  test('the empty list keeps a stable identity across renders (downstream memo guard)', async () => {
    const { fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1' })
    const first = h.list()
    await h.render()
    expect(h.list()).toBe(first)
    await h.unmount()
  })
})

/**
 * REGRESSION. A rejected fetch used to `settle([])` — seeding an EMPTY list that, being the
 * NEWEST seed, then won the freshness tie-break over live data still on screen. One flaky
 * request therefore blanked a populated Review tab.
 *
 * The rule these pin: only a RESOLVED response is authoritative about the list. A rejection
 * carries no information (the hook takes a `Promise<T[]>` — it cannot tell a 404 from a
 * dropped connection), so it must leave both the seed and the live list exactly as they were.
 * An empty RESOLVED list is a different fact — the server said "nothing" — and still clears.
 */
describe('useSeededLiveList — a failed fetch is not a fact about the list', () => {
  test('a failed reload does not blank the seed it was refreshing', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1' })
    await h.act(async () => {
      calls[0].settle(['a', 'b'])
    })
    expect(h.list()).toEqual(['a', 'b'])

    await tick()
    await h.reload()
    await h.act(async () => {
      calls[1].fail()
    })
    expect(h.list()).toEqual(['a', 'b']) // a network blip must not empty a populated list
    await h.unmount()
  })

  test('a failed reload does not suppress the live list', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    await tick()
    await h.act(async () => {
      calls[0].settle(['S'])
    })
    await h.render({ live: ['L2'] })
    expect(h.list()).toEqual(['L2'])

    // The failed seed used to land NEWER than L2 (it captured L2 as `liveWhenFetched`),
    // so the live list stopped being "fresher" and the empty seed won.
    await tick()
    await h.reload()
    await h.act(async () => {
      calls[1].fail()
    })
    expect(h.list()).toEqual(['L2'])
    await h.unmount()
  })

  test('a failing FIRST fetch leaves the live list showing', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    await h.act(async () => {
      calls[0].fail()
    })
    expect(h.list()).toEqual(['L'])
    await h.unmount()
  })

  test('an empty RESOLVED list still clears — the server said there is nothing', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1' })
    await h.act(async () => {
      calls[0].settle(['a'])
    })

    await tick()
    await h.reload()
    await h.act(async () => {
      calls[1].settle([])
    }) // e.g. the last suggestion was rejected
    expect(h.list()).toEqual([])
    await h.unmount()
  })

  test('a recovered reload after a failure lands normally', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1' })
    await h.act(async () => {
      calls[0].settle(['a'])
    })

    await h.reload()
    await h.act(async () => {
      calls[1].fail()
    })
    await h.reload()
    await h.act(async () => {
      calls[2].settle(['a', 'b'])
    })
    expect(h.list()).toEqual(['a', 'b'])
    await h.unmount()
  })
})

describe('useSeededLiveList — render cost', () => {
  /**
   * REGRESSION (react-hooks/set-state-in-effect). The freshness tie-break used to be a
   * `Date.now()` stamp written by `setLiveAt` INSIDE an effect keyed on `live`: every live
   * event therefore committed TWICE — once with the pre-stamp list, then again when the
   * effect's setState re-rendered — and the winning list landed one commit late. The
   * tie-break is now derived from the live list's IDENTITY at seed time, so a live event
   * costs exactly the one render React already owed it.
   */
  test('a live event costs exactly ONE render pass', async () => {
    const { calls, fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    await tick()
    await h.act(async () => {
      calls[0].settle(['S'])
    })

    const before = h.renders.length
    await h.render({ live: ['L2'] })
    expect(h.renders.length - before).toBe(1)
    expect(h.list()).toEqual(['L2'])
    await h.unmount()
  })

  test('mounting with a live list does not schedule a second render', async () => {
    const { fetchList } = heldFetch()
    const h = await mountList(fetchList, { sessionId: 's1', live: ['L'] })
    expect(h.renders).toHaveLength(1)
    await h.unmount()
  })
})
