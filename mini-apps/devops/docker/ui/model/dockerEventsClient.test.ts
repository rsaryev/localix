import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'

import {
  createEventRefreshBatcher,
  DOCKER_EVENTS,
  dockerEventsFeed,
  dockerEventsFollower,
  type DockerEventsFollower,
} from './dockerEventsClient'

const followDockerEvents = (follower: DockerEventsFollower) =>
  dockerEventsFeed.follow(DOCKER_EVENTS, dockerEventsFollower(follower))

function fakeRealtime() {
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  const disconnects = new Set<() => void>()
  const requests: Record<string, unknown>[] = []
  const unbind = bindMiniAppUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== 'k') return () => {}
        frames.add(handler)
        return () => frames.delete(handler)
      },
      onReconnect: (handler: () => void) => {
        reconnects.add(handler)
        return () => reconnects.delete(handler)
      },
      onDisconnect: (handler: () => void) => {
        disconnects.add(handler)
        return () => disconnects.delete(handler)
      },
      request: async (payload: Record<string, unknown>) => {
        requests.push(payload)
        return {}
      },
    },
  } as unknown as MiniAppUiRuntime)
  return {
    requests,
    push: (frame: unknown) => {
      for (const handler of frames) handler(JSON.stringify(frame))
    },
    reconnect: () => reconnects.forEach((handler) => handler()),
    disconnect: () => disconnects.forEach((handler) => handler()),
    listeners: () => frames.size,
    unbind,
  }
}

let socket: ReturnType<typeof fakeRealtime>
beforeEach(() => {
  socket = fakeRealtime()
})
afterEach(() => socket.unbind())

describe('followDockerEvents', () => {
  test('the sidebar and a container tab share ONE subscription, released by the last', () => {
    const offA = followDockerEvents({})
    const offB = followDockerEvents({})
    expect(socket.requests).toEqual([{ t: 'devops:docker.events.subscribe' }])
    offA()
    expect(socket.listeners()).toBe(1)
    offB()
    expect(socket.requests.at(-1)).toEqual({ t: 'devops:docker.events.unsubscribe' })
    expect(socket.listeners()).toBe(0)
  })

  test('liveness follows the backend, drops with the socket, and a resumed stream resyncs', () => {
    const live: boolean[] = []
    let resyncs = 0
    const events: unknown[] = []
    const off = followDockerEvents({
      live: (value) => live.push(value),
      resync: () => (resyncs += 1),
      event: (frame) => events.push(frame),
    })
    socket.push({ kind: 'status', status: 'live' })
    socket.push({ kind: 'event', type: 'container', action: 'die', id: 'abc' })
    expect(events).toEqual([{ kind: 'event', type: 'container', action: 'die', id: 'abc' }])

    socket.disconnect()
    socket.reconnect()
    // A server-side stream does not survive a new socket: subscribed again, down until `live`.
    expect(socket.requests.filter((r) => r.t === 'devops:docker.events.subscribe')).toHaveLength(2)
    socket.push({ kind: 'status', status: 'live' })
    expect(live).toEqual([true, false, true])
    expect(resyncs).toBe(2)
    off()
  })
})

describe('createEventRefreshBatcher', () => {
  test('a burst re-reads once, with the strongest scope it asked for', () => {
    jest.useFakeTimers()
    const runs: string[] = []
    const batcher = createEventRefreshBatcher<'containers' | 'all'>(
      (scope) => runs.push(scope),
      (a, b) => (a === 'all' || b === 'all' ? 'all' : 'containers'),
      5,
    )
    batcher.push('containers')
    batcher.push('all')
    batcher.push('containers')
    jest.advanceTimersByTime(5)
    jest.useRealTimers()
    expect(runs).toEqual(['all'])
  })
})
