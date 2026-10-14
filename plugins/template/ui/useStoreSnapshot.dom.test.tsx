import { afterAll, beforeAll, expect, test } from 'bun:test'
import { z } from 'zod'
import { bindPluginUiRuntime, type PluginUiRuntime } from '@localixai/plugin-sdk/ui/runtime'
import { bindPluginUiTransport } from '@localixai/plugin-sdk/ui/transport'
import { registerDom } from '@localixai/kit/testing'
import { STORE_FRAME_TAG } from '../shared/store-feed'

let teardown: () => Promise<void>
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => {
  teardown = registerDom()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await teardown()
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

function fakeHost() {
  let server = { n: 0 }
  let reads = 0
  const frames = new Set<(json: string) => void>()
  const reconnects = new Set<() => void>()
  const disconnects = new Set<() => void>()
  const commands: string[] = []
  const unbindTransport = bindPluginUiTransport({
    url: (path) => path,
    request: async () => {
      reads += 1
      return Response.json(server)
    },
  })
  const unbindRuntime = bindPluginUiRuntime({
    realtime: {
      onFrame: (tag: string, handler: (json: string) => void) => {
        if (tag !== STORE_FRAME_TAG) return () => {}
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
        commands.push(`${String(payload.t)} ${String(payload.sessionId)}`)
        if (String(payload.t).endsWith('.subscribe')) {
          queueMicrotask(() => {
            for (const handler of frames)
              handler(JSON.stringify({ plugin: 'probe', sessionId: payload.sessionId, live: true }))
          })
        }
        return String(payload.t).endsWith('.subscribe') ? { subscribed: true } : {}
      },
    },
  } as unknown as PluginUiRuntime)
  return {
    set: (n: number) => (server = { n }),
    reads: () => reads,
    commands,
    frame: (frame: unknown) => {
      for (const handler of frames) handler(JSON.stringify(frame))
    },
    disconnect: () => disconnects.forEach((handler) => handler()),
    reconnect: () => reconnects.forEach((handler) => handler()),
    unbind: () => {
      unbindRuntime()
      unbindTransport()
    },
  }
}

/**
 * A board saw the agent's move only when its poll came round, and polled every 800 ms to keep that
 * short. The store feed's nudge re-reads at once; a nudge for another plugin or chat does not; and
 * the hook says whether it is live, which is what lets the poll fall back to the slow backstop.
 */
test('a nudge for this scope re-reads at once; one for another scope does not', async () => {
  const { act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useStoreSnapshot } = await import('./useStoreSnapshot')
  const host = fakeHost()
  let live = null as boolean | null
  function Probe({ id }: { id: string }) {
    const state = useStoreSnapshot({
      plugin: 'probe',
      sessionId: 'chat-1',
      path: `/rpc/probe/count?${id}`,
      schema: z.object({ n: z.number() }),
      intervalMs: 60_000,
      failureMessage: 'Cannot read.',
    })
    live = state.live
    return <p>{state.snapshot?.n ?? 'none'}</p>
  }
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(async () => root.render(<Probe id="a" />))
    expect(element.textContent).toBe('0')
    expect(live).toBe(true)
    expect(host.commands).toEqual(['probe:store.subscribe chat-1'])

    host.set(1)
    await act(async () => host.frame({ plugin: 'probe', sessionId: 'chat-1' }))
    expect(element.textContent).toBe('1')

    const before = host.reads()
    host.set(2)
    await act(async () => {
      host.frame({ plugin: 'other', sessionId: 'chat-1' })
      host.frame({ plugin: 'probe', sessionId: 'chat-2' })
    })
    expect(host.reads()).toBe(before)
    expect(element.textContent).toBe('1')

    // Down: not live, so the poll is back at its own cadence; back: one resubscribe, live again,
    // and one re-read, since a nudge sent while the socket was down is gone.
    await act(async () => host.disconnect())
    expect(live).toBe(false)
    host.set(3)
    await act(async () => host.reconnect())
    expect(live).toBe(true)
    expect(element.textContent).toBe('3')
    expect(host.commands).toEqual(['probe:store.subscribe chat-1', 'probe:store.subscribe chat-1'])
  } finally {
    await act(async () => root.unmount())
    host.unbind()
    element.remove()
  }
  expect(host.commands.at(-1)).toBe('probe:store.unsubscribe chat-1')
})

/**
 * One subscription per scope, however many views follow it. A reconnect resubscribes each scope
 * ONCE, so a subscription per follower left the host counting one while each follower unsubscribed
 * — and the first to leave ended the stream for the rest.
 */
test('two views of one scope share one subscription, and the last to leave ends it', async () => {
  const { act } = await import('react')
  const { storeFeed } = await import('./useStoreSnapshot')
  const host = fakeHost()
  const changed: string[] = []
  const follow = (name: string) =>
    storeFeed.follow({ plugin: 'probe', sessionId: 'chat-1' }, { frame: () => changed.push(name) })
  try {
    let leaveA = () => {}
    let leaveB = () => {}
    await act(async () => {
      leaveA = follow('a')
      leaveB = follow('b')
    })
    expect(host.commands).toEqual(['probe:store.subscribe chat-1'])
    leaveA()
    host.frame({ plugin: 'probe', sessionId: 'chat-1' })
    expect(changed).toEqual(['b'])
    expect(host.commands).toEqual(['probe:store.subscribe chat-1'])
    await act(async () => leaveB())
    expect(host.commands.at(-1)).toBe('probe:store.unsubscribe chat-1')
  } finally {
    host.unbind()
  }
})
