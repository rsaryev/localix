import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { bindMiniAppUiRuntime, type MiniAppUiRuntime } from '@localixai/mini-app-sdk/ui/runtime'
import { isBackgroundWork } from '@localixai/mini-app-sdk/ui/visibility'

import { logFollowFeed, logFollower, type LogFollowTarget } from './logFollowFeed'

function fakeRealtime() {
  const frames = new Set<(json: string) => void>()
  const requests: Record<string, unknown>[] = []
  const unbind = bindMiniAppUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== 'l') return () => {}
        frames.add(handler)
        return () => frames.delete(handler)
      },
      onReconnect: () => () => {},
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
    unbind,
  }
}

let socket: ReturnType<typeof fakeRealtime>
beforeEach(() => {
  socket = fakeRealtime()
})
afterEach(() => socket.unbind())

const docker: LogFollowTarget = { provider: 'docker', containerId: 'f00d' }
const pod: LogFollowTarget = {
  provider: 'k8s',
  context: '',
  namespace: 'shop',
  pod: 'web-1',
  containers: ['app'],
}

describe('the log follow feed', () => {
  test('subscribes each runtime with its own command', () => {
    const offA = logFollowFeed.follow(docker, {})
    const offB = logFollowFeed.follow(pod, {})
    expect(socket.requests).toEqual([
      { t: 'devops:docker.logs.subscribe', containerId: 'f00d' },
      {
        t: 'devops:k8s.logs.subscribe',
        context: undefined,
        namespace: 'shop',
        pod: 'web-1',
        containers: ['app'],
      },
    ])
    offA()
    offB()
  })

  test('the tab reads new lines when its log grows, and when the follow comes up', () => {
    const reads: boolean[] = []
    const off = logFollowFeed.follow(
      docker,
      logFollower(() => reads.push(isBackgroundWork())),
    )
    socket.push({ kind: 'status', key: 'docker\nf00d', status: 'live' })
    expect(reads).toEqual([true])
    expect(logFollowFeed.live(docker)).toBe(true)
    socket.push({ kind: 'grew', key: 'docker\nf00d' })
    expect(reads).toEqual([true, true])
    // Another container's output is not this tab's.
    socket.push({ kind: 'grew', key: 'docker\nbeef' })
    expect(reads).toHaveLength(2)
    off()
  })
})
