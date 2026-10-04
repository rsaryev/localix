import { describe, expect, it } from 'bun:test'
import {
  createSuggestHub,
  gatherOffers,
  type SuggestOffer,
  type SuggestOfferProvider,
  type SuggestSurfaceId,
  type SuggestResultMap,
} from './suggestCore'

function providersOf(entries: [SuggestSurfaceId, SuggestOfferProvider][]) {
  const map = new Map<SuggestSurfaceId, Set<SuggestOfferProvider>>()
  for (const [id, fn] of entries) {
    if (!map.has(id)) map.set(id, new Set())
    map.get(id)!.add(fn)
  }
  return map
}

const chatOffer = (sessionId = 's1', key = 'm1::draft'): SuggestOffer => ({
  sessionId,
  key,
  payload: { draft: 'draft' },
})

const commitOffer = (key = 'diff1::feat'): SuggestOffer => ({
  sessionId: 's1',
  key,
  payload: { draft: 'feat', repoRoot: '/repo' },
})

describe('gatherOffers', () => {
  it('gathers chat + commit into ONE payload set and combined fingerprint', () => {
    const { surfaces, fingerprint, count } = gatherOffers(
      providersOf([
        ['chat', () => chatOffer()],
        ['fixture.commit', () => commitOffer()],
      ]),
      's1',
    )
    expect(count).toBe(2)
    expect(surfaces.chat).toMatchObject({ draft: 'draft' })
    expect(surfaces['fixture.commit']).toEqual({ draft: 'feat', repoRoot: '/repo' })
    expect(fingerprint).toBe('s1|chat=m1::draft|fixture.commit=diff1::feat')
  })

  it('a surface returning null is simply absent', () => {
    const { surfaces, count } = gatherOffers(providersOf([['chat', () => null]]), 's1')
    expect(count).toBe(0)
    expect(surfaces.chat).toBeUndefined()
  })

  it('skips offers for other sessions', () => {
    const { count } = gatherOffers(providersOf([['chat', () => chatOffer('other')]]), 's1')
    expect(count).toBe(0)
  })

  it('within a surface, the first non-null session-matching provider wins', () => {
    const { surfaces } = gatherOffers(
      providersOf([
        ['chat', () => null],
        ['chat', () => chatOffer('s1', 'm9::a')],
      ]),
      's1',
    )
    expect(surfaces.chat).toBeDefined()
  })

  it('fingerprint changes when any surface key changes', () => {
    const a = gatherOffers(providersOf([['commit', () => commitOffer('diff1')]]), 's1')
    const b = gatherOffers(providersOf([['commit', () => commitOffer('diff2')]]), 's1')
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })

  it('a throwing provider is treated as null', () => {
    const { count } = gatherOffers(
      providersOf([
        [
          'chat',
          () => {
            throw new Error('boom')
          },
        ],
      ]),
      's1',
    )
    expect(count).toBe(0)
  })
})

describe('createSuggestHub', () => {
  it('only regenerates changed surfaces and expires negative entries sooner', async () => {
    let clock = 0
    let commitKey = 'c1'
    const payloads: string[][] = []
    const hub = createSuggestHub(
      async (_session, surfaces): Promise<SuggestResultMap> => {
        payloads.push(Object.keys(surfaces))
        return surfaces.chat ? { chat: ' cached' } : {}
      },
      30,
      60_000,
      () => clock,
    )
    hub.registerProvider('chat', () => chatOffer('s1', 'same'))
    hub.registerProvider('commit', () => commitOffer(commitKey))
    await hub.request('s1')
    commitKey = 'c2'
    expect(await hub.request('s1')).toEqual({ chat: ' cached' })
    clock = 10_001
    await hub.request('s1')
    expect(payloads).toEqual([['chat', 'commit'], ['commit'], ['commit']])
    await hub.request('s1', true)
    expect(payloads.at(-1)).toEqual(['chat', 'commit'])
  })

  it('sends the working set once per call and never reuses an answer given beside another file', async () => {
    let open = [{ kind: 'file', token: '@file:a.ts', label: 'a.ts' }]
    const sent: unknown[] = []
    const hub = createSuggestHub(
      async (_session, _surfaces, _signal, references): Promise<SuggestResultMap> => {
        sent.push(references)
        return { chat: ' next' }
      },
      30,
      60_000,
      () => 0,
      () => open,
    )
    hub.registerProvider('chat', () => chatOffer('s1', 'same draft'))
    hub.registerProvider('commit', () => commitOffer('c1'))
    await hub.request('s1')
    await hub.request('s1')
    expect(sent).toHaveLength(1)
    open = [{ kind: 'file', token: '@file:b.ts', label: 'b.ts' }]
    await hub.request('s1')
    expect(sent).toEqual([
      [{ kind: 'file', token: '@file:a.ts', label: 'a.ts' }],
      [{ kind: 'file', token: '@file:b.ts', label: 'b.ts' }],
    ])
  })

  it('does not cache transport failures as empty answers', async () => {
    let calls = 0
    const hub = createSuggestHub(async () => {
      if (++calls === 1) throw new Error('timeout')
      return { chat: ' recovered' }
    })
    hub.registerProvider('chat', () => chatOffer())
    await expect(hub.request('s1')).rejects.toThrow('timeout')
    expect(await hub.request('s1')).toEqual({ chat: ' recovered' })
    expect(calls).toBe(2)
  })
  it('fans one fresh response out with the exact keys of every offered surface', async () => {
    const hub = createSuggestHub(async () => ({ chat: ' tests', commit: ': add tests' }))
    hub.registerProvider('chat', () => chatOffer('s1', 'chat-key'))
    hub.registerProvider('commit', () => commitOffer('commit-key'))
    const deliveries: Parameters<Parameters<typeof hub.subscribe>[0]>[0][] = []
    hub.subscribe((delivery) => deliveries.push(delivery))

    expect(await hub.request('s1')).toEqual({ chat: ' tests', commit: ': add tests' })
    expect(deliveries).toEqual([
      {
        sessionId: 's1',
        // The empty working set is part of the in-flight identity too.
        fingerprint: 's1|chat=chat-key|commit=commit-key|[]',
        keys: { chat: 'chat-key', commit: 'commit-key' },
        result: { chat: ' tests', commit: ': add tests' },
        source: 'fresh',
      },
    ])
  })

  it('joins an identical in-flight request', async () => {
    let resolve!: (result: { chat: string }) => void
    const pending = new Promise<{ chat: string }>((done) => {
      resolve = done
    })
    let calls = 0
    const hub = createSuggestHub(async () => {
      calls++
      return pending
    })
    hub.registerProvider('chat', () => chatOffer('s1', 'same'))

    const first = hub.request('s1')
    const second = hub.request('s1')
    expect(calls).toBe(1)
    resolve({ chat: ' result' })
    expect(await first).toEqual({ chat: ' result' })
    expect(await second).toEqual({ chat: ' result' })
  })

  it('aborts a superseded request per session and never delivers its stale result', async () => {
    let key = 'old'
    const signals: AbortSignal[] = []
    const hub = createSuggestHub(async (_sessionId, _surfaces, signal) => {
      signals.push(signal)
      if (signals.length === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Superseded', 'AbortError')),
            { once: true },
          )
        })
      }
      return { chat: ' newest' }
    })
    hub.registerProvider('chat', () => chatOffer('s1', key))
    const deliveries: string[] = []
    hub.subscribe((delivery) => deliveries.push(delivery.keys.chat ?? ''))

    const stale = hub.request('s1').catch(() => ({}))
    key = 'new'
    expect(await hub.request('s1')).toEqual({ chat: ' newest' })
    expect(await stale).toEqual({})
    expect(signals[0]?.aborted).toBe(true)
    expect(deliveries).toEqual(['new'])
  })

  // Losing a race is not the only reason to stop paying for a call. Submitting the
  // composer, blurring, dismissing or unmounting leaves NOBODY able to show the
  // answer, and clearing a debounce timer does nothing to a request already in
  // flight. Losing a race and being abandoned are two separate cancellation kinds;
  // this hub only had the first.
  describe('abandonment', () => {
    const pendingHub = () => {
      const signals: AbortSignal[] = []
      const hub = createSuggestHub(async (_sessionId, _surfaces, signal) => {
        signals.push(signal)
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')), {
            once: true,
          })
        })
      })
      return { hub, signals }
    }

    it('aborts the in-flight call once no surface offers anymore', async () => {
      const { hub, signals } = pendingHub()
      let eligible = true
      hub.registerProvider('chat', () => (eligible ? chatOffer('s1', 'k1') : null))
      const inflight = hub.request('s1').catch(() => ({}))

      // The surface goes ineligible — submitted, blurred, dismissed, unmounted.
      eligible = false
      expect(hub.abandon('s1')).toBe(true)
      expect(signals[0]?.aborted).toBe(true)
      expect(await inflight).toEqual({})
    })

    it('is a no-op while the surface is still offering, so a keystroke cleanup is safe', async () => {
      const { hub, signals } = pendingHub()
      hub.registerProvider('chat', () => chatOffer('s1', 'k1'))
      const inflight = hub.request('s1').catch(() => ({}))

      expect(hub.abandon('s1')).toBe(false)
      expect(signals[0]?.aborted).toBe(false)
      void inflight
    })

    it('does not strand a second surface still waiting on the shared call', async () => {
      const { hub, signals } = pendingHub()
      let chatEligible = true
      hub.registerProvider('chat', () => (chatEligible ? chatOffer('s1', 'k1') : null))
      hub.registerProvider('commit', () => commitOffer('c1'))
      const inflight = hub.request('s1').catch(() => ({}))

      // Only the chat surface walked away; commit still wants its slice.
      chatEligible = false
      expect(hub.abandon('s1')).toBe(false)
      expect(signals[0]?.aborted).toBe(false)
      void inflight
    })

    it('reports false when there is nothing in flight to abandon', () => {
      const { hub } = pendingHub()
      expect(hub.abandon('s1')).toBe(false)
    })
  })

  it('notifies consumers on cache hits without a second transport call', async () => {
    let calls = 0
    const hub = createSuggestHub(async () => {
      calls++
      return { chat: ' cached' }
    })
    hub.registerProvider('chat', () => chatOffer('s1', 'cache-key'))
    const sources: string[] = []
    hub.subscribe((delivery) => sources.push(delivery.source))

    await hub.request('s1')
    await hub.request('s1')
    expect(calls).toBe(1)
    expect(sources).toEqual(['fresh', 'cache'])
  })
})
