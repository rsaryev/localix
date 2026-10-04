import { describe, expect, it } from 'bun:test'
import {
  createSuggestHub,
  type SuggestDelivery,
  type SuggestOffer,
  type SuggestSurfacePayloads,
} from './suggestCore'

const chatOffer = (draft = 'fix the'): SuggestOffer => ({
  sessionId: 's1',
  key: `m1::${draft}`,
  payload: { draft },
})

const commitOffer = (): SuggestOffer => ({
  sessionId: 's1',
  key: 'diff1::feat',
  payload: { draft: 'feat', repoRoot: '/repo' },
})

function fakeSend(result: { chat?: string; commit?: string }) {
  const calls: { sessionId: string; surfaces: SuggestSurfacePayloads }[] = []
  const send = (sessionId: string, surfaces: SuggestSurfacePayloads, _signal: AbortSignal) => {
    calls.push({ sessionId, surfaces })
    return Promise.resolve(result)
  }
  return { calls, send }
}

describe('createSuggestHub', () => {
  it('one request carries chat + commit in ONE transport call', async () => {
    const { calls, send } = fakeSend({ chat: 'ship it', commit: '(ui): add completion' })
    const hub = createSuggestHub(send)
    hub.registerProvider('chat', () => chatOffer())
    hub.registerProvider('commit', () => commitOffer())

    const result = await hub.request('s1')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.surfaces.chat).toEqual({ draft: 'fix the' })
    expect(calls[0]!.surfaces.commit).toEqual({ draft: 'feat', repoRoot: '/repo' })
    expect(result).toEqual({ chat: 'ship it', commit: '(ui): add completion' })
  })

  it('fans a fresh result out to subscribers', async () => {
    const { send } = fakeSend({ chat: 'a' })
    const hub = createSuggestHub(send)
    hub.registerProvider('chat', () => chatOffer())
    const seen: SuggestDelivery[] = []
    const unsubscribe = hub.subscribe((delivery) => {
      seen.push(delivery)
    })

    await hub.request('s1')
    expect(seen).toEqual([
      {
        sessionId: 's1',
        fingerprint: 's1|chat=m1::fix the|[]',
        keys: { chat: 'm1::fix the' },
        result: { chat: 'a' },
        source: 'fresh',
      },
    ])

    unsubscribe()
    hub.registerProvider('chat', () => chatOffer('other'))
    await hub.request('s1')
    expect(seen).toHaveLength(1)
  })

  it('a throwing subscriber never breaks the hub or caller', () => {
    const { send } = fakeSend({ chat: 'a' })
    const hub = createSuggestHub(send)
    hub.registerProvider('chat', () => chatOffer())
    hub.subscribe(() => {
      throw new Error('boom')
    })
    expect(hub.request('s1')).resolves.toEqual({ chat: 'a' })
  })

  it('identical concurrent requests join one in-flight call', async () => {
    const calls: string[] = []
    let release!: (result: { chat?: string; commit?: string }) => void
    const hub = createSuggestHub((sessionId) => {
      calls.push(sessionId)
      return new Promise((resolve) => {
        release = resolve
      })
    })
    hub.registerProvider('chat', () => chatOffer())
    const first = hub.request('s1')
    const second = hub.request('s1')
    expect(calls).toHaveLength(1)
    release({ chat: 'x' })
    expect(await first).toEqual({ chat: 'x' })
    expect(await second).toEqual({ chat: 'x' })
  })

  it('serves unchanged combined context from cache', async () => {
    const { calls, send } = fakeSend({ chat: 'a' })
    const hub = createSuggestHub(send)
    hub.registerProvider('chat', () => chatOffer())
    expect(await hub.request('s1')).toEqual({ chat: 'a' })
    expect(await hub.request('s1')).toEqual({ chat: 'a' })
    expect(calls).toHaveLength(1)
  })

  it('refreshes an unchanged client key after the bounded cache TTL', async () => {
    let now = 100
    const { calls, send } = fakeSend({ chat: 'a' })
    const hub = createSuggestHub(send, 30, 1_000, () => now)
    hub.registerProvider('chat', () => chatOffer())
    await hub.request('s1')
    now = 1_101
    await hub.request('s1')
    expect(calls).toHaveLength(2)
  })

  it('returns empty without transport when no surface offers', async () => {
    const { calls, send } = fakeSend({})
    const hub = createSuggestHub(send)
    hub.registerProvider('chat', () => null)
    expect(await hub.request('s1')).toEqual({})
    expect(calls).toHaveLength(0)
  })
})
