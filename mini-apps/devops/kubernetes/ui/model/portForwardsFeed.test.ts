import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { isBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'

import { PORT_FORWARDS, portForwardsFeed, portForwardsFollower } from './portForwardsFeed'

function fakeRealtime() {
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  const requests: Record<string, unknown>[] = []
  const unbind = bindMiniAppUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== 'f') return () => {}
        frames.add(handler)
        return () => frames.delete(handler)
      },
      onReconnect: (handler: () => void) => {
        reconnects.add(handler)
        return () => reconnects.delete(handler)
      },
      onDisconnect: () => () => {},
      request: async (payload: Record<string, unknown>) => {
        requests.push(payload)
        return { subscribed: true }
      },
    },
  } as unknown as MiniAppUiRuntime)
  return {
    requests,
    push: (frame: unknown) => frames.forEach((handler) => handler(JSON.stringify(frame))),
    reconnect: () => reconnects.forEach((handler) => handler()),
    unbind,
  }
}

let socket: ReturnType<typeof fakeRealtime>
beforeEach(() => {
  socket = fakeRealtime()
})
afterEach(() => socket.unbind())

describe('the port-forward change feed', () => {
  test('the sidebar and a pod tab share ONE subscription, released by the last', () => {
    const offA = portForwardsFeed.follow(PORT_FORWARDS, {})
    const offB = portForwardsFeed.follow(PORT_FORWARDS, {})
    expect(socket.requests).toEqual([{ t: 'devops:k8s.forwards.subscribe' }])
    offA()
    offB()
    expect(socket.requests.at(-1)).toEqual({ t: 'devops:k8s.forwards.unsubscribe' })
  })

  test('re-reads on a change, when the stream comes up and after a reconnect, as background work', async () => {
    const reads: boolean[] = []
    const off = portForwardsFeed.follow(
      PORT_FORWARDS,
      portForwardsFollower(() => reads.push(isBackgroundWork())),
    )
    // The subscribe's answer makes the stream live: whatever changed before it is read.
    await Promise.resolve()
    await Promise.resolve()
    expect(reads).toEqual([true])
    socket.push({ kind: 'changed' })
    expect(reads).toHaveLength(2)
    socket.reconnect()
    expect(reads).toHaveLength(3)
    expect(reads.every(Boolean)).toBe(true)
    off()
  })
})
