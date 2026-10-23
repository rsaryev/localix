import { afterEach, describe, expect, test } from 'bun:test'

import { createRealtimeFeed, type RealtimeFeedSpec } from './realtime-feed'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from './runtime'

let unbind: (() => void) | undefined
afterEach(() => {
  unbind?.()
  unbind = undefined
})

/** A host socket the test drives: frames, drops, reconnects and the subscribe answers. */
function fakeSocket(options: { disconnect?: boolean } = {}) {
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  const disconnects = new Set<() => void>()
  const commands: string[] = []
  const answers: Array<(accepted: boolean) => void> = []
  let answerAtOnce = true
  const on = (set: Set<() => void>) => (handler: () => void) => {
    set.add(handler)
    return () => set.delete(handler)
  }
  unbind = bindMiniAppUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== 'q') throw new Error(`unexpected tag ${tag}`)
        frames.add(handler)
        return () => frames.delete(handler)
      },
      onReconnect: on(reconnects),
      // An older host has no disconnect signal; the feed must still work without it.
      ...(options.disconnect === false ? {} : { onDisconnect: on(disconnects) }),
      request: (payload: { t: string; id: string }) => {
        commands.push(`${payload.t} ${payload.id}`)
        if (!payload.t.endsWith('.subscribe')) return Promise.resolve({ unsubscribed: true })
        if (answerAtOnce) return Promise.resolve({ subscribed: true })
        return new Promise((resolve) => answers.push((ok) => resolve({ subscribed: ok })))
      },
    },
  } as unknown as MiniAppUiRuntime)
  return {
    commands,
    frame: (value: unknown) => frames.forEach((handler) => handler(JSON.stringify(value))),
    raw: (json: string) => frames.forEach((handler) => handler(json)),
    disconnect: () => disconnects.forEach((handler) => handler()),
    reconnect: () => reconnects.forEach((handler) => handler()),
    holdAnswers: () => (answerAtOnce = false),
    answer: (accepted: boolean) => answers.shift()?.(accepted),
    listening: () => frames.size + reconnects.size + disconnects.size,
  }
}

type Frame = { id?: string; n?: number; status?: 'live' | 'down' }
const spec = (over: Partial<RealtimeFeedSpec<string, Frame>> = {}) =>
  createRealtimeFeed<string, Frame>({
    tag: 'q',
    subscribe: (id) => ({ t: 'p:x.subscribe', id }),
    unsubscribe: (id) => ({ t: 'p:x.unsubscribe', id }),
    decode: (json) => JSON.parse(json) as Frame,
    route: (frame) => frame.id ?? null,
    ...over,
  })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createRealtimeFeed', () => {
  test('one subscription per key, routed by key, released with the last follower', () => {
    const socket = fakeSocket()
    const feed = spec()
    const seen: string[] = []
    const offA1 = feed.follow('a', { frame: (f) => seen.push(`a1:${f.n}`) })
    const offA2 = feed.follow('a', { frame: (f) => seen.push(`a2:${f.n}`) })
    const offB = feed.follow('b', { frame: (f) => seen.push(`b:${f.n}`) })
    expect(socket.commands).toEqual(['p:x.subscribe a', 'p:x.subscribe b'])

    socket.frame({ id: 'a', n: 1 })
    socket.frame({ id: 'c', n: 2 })
    socket.raw('not json')
    socket.frame({ n: 3 }) // no key: every followed key
    expect(seen).toEqual(['a1:1', 'a2:1', 'a1:3', 'a2:3', 'b:3'])

    offA1()
    offA1() // a second release of the same follower must not end the other's stream
    expect(socket.commands).toHaveLength(2)
    offA2()
    expect(socket.commands.at(-1)).toBe('p:x.unsubscribe a')
    expect(socket.listening()).toBe(3)
    offB()
    expect(socket.listening()).toBe(0)
  })

  test('live follows the answer, falls with the socket, and a reconnect resubscribes once', async () => {
    const socket = fakeSocket()
    const feed = spec()
    const events: string[] = []
    const off = feed.follow('a', {
      live: (live) => events.push(`live:${live}`),
      reconnect: () => events.push('reconnect'),
    })
    await settle()
    expect(feed.live('a')).toBe(true)
    // A follower joining a live key reads the state; it is told only of changes.
    const joiner: boolean[] = []
    const offJoiner = feed.follow('a', { live: (live) => joiner.push(live) })
    expect(feed.live('a')).toBe(true)

    socket.disconnect()
    socket.reconnect()
    await settle()
    expect(events).toEqual(['live:true', 'live:false', 'reconnect', 'live:true'])
    expect(joiner).toEqual([false, true])
    expect(socket.commands).toEqual(['p:x.subscribe a', 'p:x.subscribe a'])
    offJoiner()
    off()
  })

  test('a host without a disconnect signal still falls at the reconnect', async () => {
    const socket = fakeSocket({ disconnect: false })
    const feed = spec()
    const events: boolean[] = []
    const off = feed.follow('a', { live: (live) => events.push(live) })
    await settle()
    socket.holdAnswers()
    socket.reconnect()
    expect(events).toEqual([true, false])
    socket.answer(true)
    await settle()
    expect(events).toEqual([true, false, true])
    off()
  })

  test('a late answer changes nothing: released, re-followed, or superseded', async () => {
    const socket = fakeSocket()
    socket.holdAnswers()
    const feed = spec()
    const first: boolean[] = []
    feed.follow('a', { live: (live) => first.push(live) })()
    const second: boolean[] = []
    const off = feed.follow('a', { live: (live) => second.push(live) })
    socket.answer(true) // the released follower's subscribe
    await settle()
    expect(first).toEqual([])
    expect(second).toEqual([])
    expect(feed.live('a')).toBe(false)

    socket.reconnect() // supersedes the second follow's pending subscribe
    socket.answer(true) // ...whose answer arrives now: late
    await settle()
    expect(feed.live('a')).toBe(false)
    socket.answer(false) // the reconnect's own answer decides
    await settle()
    expect(feed.live('a')).toBe(false)
    expect(second).toEqual([])
    off()
  })

  test('with `status`, only status frames set live, per routed key', async () => {
    const socket = fakeSocket()
    const feed = spec({
      status: (frame) => (frame.status === undefined ? undefined : frame.status === 'live'),
    })
    const seen: string[] = []
    const offA = feed.follow('a', {
      frame: (f) => seen.push(`a:${f.n}`),
      live: (live) => seen.push(`a:live:${live}`),
    })
    const offB = feed.follow('b', { live: (live) => seen.push(`b:live:${live}`) })
    await settle()
    expect(feed.live('a')).toBe(false) // the host's answer is not the source's word

    socket.frame({ id: 'a', status: 'live' })
    socket.frame({ status: 'live' })
    socket.frame({ id: 'a', n: 7 })
    socket.disconnect()
    expect(seen).toEqual(['a:live:true', 'b:live:true', 'a:7', 'a:live:false', 'b:live:false'])
    offA()
    offB()
  })

  test('a host without realtime leaves the follower not live and the release harmless', () => {
    const feed = spec()
    const off = feed.follow('a', {})
    expect(feed.live('a')).toBe(false)
    off()
  })

  test('pauseWhileHidden unsubscribes while hidden and re-reads when shown', async () => {
    const socket = fakeSocket()
    const listeners = new Set<() => void>()
    const fakeDocument = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_: string, handler: () => void) => listeners.add(handler),
      removeEventListener: (_: string, handler: () => void) => listeners.delete(handler),
    }
    const scope = globalThis as { document?: unknown }
    const had = 'document' in scope
    const previous = scope.document
    scope.document = fakeDocument
    try {
      const feed = spec({ pauseWhileHidden: true })
      const events: string[] = []
      const off = feed.follow('a', {
        frame: (f) => events.push(`frame:${f.n}`),
        live: (live) => events.push(`live:${live}`),
        reconnect: () => events.push('reconnect'),
      })
      await settle()
      fakeDocument.visibilityState = 'hidden'
      listeners.forEach((handler) => handler())
      socket.frame({ id: 'a', n: 1 }) // a paused key hears nothing
      fakeDocument.visibilityState = 'visible'
      listeners.forEach((handler) => handler())
      await settle()
      expect(socket.commands).toEqual(['p:x.subscribe a', 'p:x.unsubscribe a', 'p:x.subscribe a'])
      expect(events).toEqual(['live:true', 'live:false', 'reconnect', 'live:true'])
      off()
      expect(listeners.size).toBe(0)
    } finally {
      if (had) scope.document = previous
      else delete scope.document
    }
  })
})
