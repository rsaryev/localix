import { afterEach, expect, test } from 'bun:test'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { GRAPH_FRAME_TAG, GRAPH_SUBSCRIBE, GRAPH_UNSUBSCRIBE } from '../shared/stream'
import { graphFeed, graphFollower, type GraphStreamListener } from './graphStream'

const followGraphStream = (sessionId: string, listener: GraphStreamListener) =>
  graphFeed.follow(sessionId, graphFollower(listener))

let unbind: (() => void) | undefined
afterEach(() => {
  unbind?.()
  unbind = undefined
})

function fakeRealtime() {
  const frames = new Map<string, Set<(json: string) => void>>()
  const reconnects = new Set<() => void>()
  const commands: Array<{ t: string; sessionId: string }> = []
  unbind = bindMiniAppUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        const set = frames.get(tag) ?? new Set()
        frames.set(tag, set)
        set.add(handler)
        return () => set.delete(handler)
      },
      onReconnect: (handler: () => void) => {
        reconnects.add(handler)
        return () => reconnects.delete(handler)
      },
      request: async (payload: { t: string; sessionId: string }) => {
        commands.push(payload)
      },
    },
  } as unknown as MiniAppUiRuntime)
  return {
    commands,
    frame: (value: unknown) => {
      for (const handler of frames.get(GRAPH_FRAME_TAG) ?? []) handler(JSON.stringify(value))
    },
    reconnect: () => {
      for (const handler of reconnects) handler()
    },
    listening: () => (frames.get(GRAPH_FRAME_TAG)?.size ?? 0) + reconnects.size,
  }
}

/**
 * The tab's requests, camera asks and revisions arrive as frames instead of three polls. Several
 * hooks of one tab follow one chat, so the socket must carry ONE subscription for it, and each
 * frame must reach only the chat it names.
 */
test('one subscription per chat, routed by chat, released with the last listener', () => {
  const socket = fakeRealtime()
  const seen: string[] = []
  const offAgent = followGraphStream('a', {
    agent: (view) => seen.push(`a:agent:${view.revision}`),
  })
  const offCamera = followGraphStream('a', { report: () => seen.push('a:report') })
  const offOther = followGraphStream('b', {
    revision: () => seen.push('b:revision'),
    progress: () => seen.push('b:progress'),
  })
  expect(socket.commands).toEqual([
    { t: GRAPH_SUBSCRIBE, sessionId: 'a' },
    { t: GRAPH_SUBSCRIBE, sessionId: 'b' },
  ])

  socket.frame({ sessionId: 'a', agent: { revision: 3, highlight: [] } })
  socket.frame({ sessionId: 'a', report: 1 })
  socket.frame({ sessionId: 'b', revision: 2 })
  socket.frame({ sessionId: 'b', indexing: 'parsing' })
  socket.frame({ sessionId: 'c', revision: 2 })
  socket.frame({ sessionId: 'a', bogus: true })
  expect(seen).toEqual(['a:agent:3', 'a:report', 'b:revision', 'b:progress'])

  offAgent()
  expect(socket.commands).toHaveLength(2)
  offCamera()
  expect(socket.commands.at(-1)).toEqual({ t: GRAPH_UNSUBSCRIBE, sessionId: 'a' })
  offOther()
  expect(socket.listening()).toBe(0)
})

test('a reconnect re-subscribes every followed chat and tells its listeners', () => {
  const socket = fakeRealtime()
  let told = 0
  const off = followGraphStream('a', { reconnect: () => told++ })
  socket.commands.length = 0
  socket.reconnect()
  expect(socket.commands).toEqual([{ t: GRAPH_SUBSCRIBE, sessionId: 'a' }])
  expect(told).toBe(1)
  off()
})
