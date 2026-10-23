import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { isBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'

import { collectionsFeed, collectionsFollower } from './collectionsFeed'

function fakeRealtime() {
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  const requests: Record<string, unknown>[] = []
  const unbind = bindMiniAppUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== 'o') return () => {}
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

const key = { context: 'kind', namespace: 'default' }
const changed = (namespace: string) => ({
  kind: 'changed',
  context: 'kind',
  namespace,
  collections: ['deployments'],
})

describe('the collection change feed', () => {
  test('a changed frame re-reads at once as background work — no timer involved', () => {
    const reads: boolean[] = []
    const off = collectionsFeed.follow(
      key,
      collectionsFollower(() => reads.push(isBackgroundWork())),
    )
    expect(socket.requests).toEqual([
      { t: 'devops:k8s.collections.subscribe', context: 'kind', namespace: 'default' },
    ])
    socket.push(changed('default'))
    expect(reads).toEqual([true])
    // Another namespace's change is not this view's.
    socket.push(changed('kube-system'))
    expect(reads).toHaveLength(1)
    socket.reconnect()
    expect(reads).toHaveLength(2)
    off()
    expect(socket.requests.at(-1)).toEqual({
      t: 'devops:k8s.collections.unsubscribe',
      context: 'kind',
      namespace: 'default',
    })
  })

  test('liveness is the watch status frame, not the subscribe answer', async () => {
    const live: boolean[] = []
    const off = collectionsFeed.follow(key, { live: (next) => live.push(next) })
    await Promise.resolve()
    await Promise.resolve()
    expect(collectionsFeed.live(key)).toBe(false)
    socket.push({ kind: 'status', context: 'kind', namespace: 'default', status: 'live' })
    expect(live).toEqual([true])
    socket.push({ kind: 'status', context: 'kind', namespace: 'default', status: 'down' })
    expect(live).toEqual([true, false])
    off()
  })
})
