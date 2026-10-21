import { describe, expect, test } from 'bun:test'
import type { AgentStreamEvent } from './contracts'
import { startResourceSyncTransport } from './resourceSyncTransport'

function harness(resumed: boolean, connected = false) {
  const calls: unknown[] = []
  const handlers = { connected: () => {}, resync: () => {}, down: () => {} }
  let onEvent: (id: string, event: AgentStreamEvent) => void = () => {}
  const socket = {
    onConnected: (handler: () => void) => ((handlers.connected = handler), () => {}),
    onDisconnect: (handler: () => void) => ((handlers.down = handler), () => {}),
    onResyncRequired: (handler: () => void) => ((handlers.resync = handler), () => {}),
    onSessionEvent: (handler: typeof onEvent) => ((onEvent = handler), () => {}),
    isConnected: () => connected,
    resumedWithReplay: () => resumed,
  }
  const sync = {
    connected: (options?: { replayed?: boolean }) => calls.push(['connected', options]),
    disconnected: () => calls.push(['disconnected']),
    invalidate: (resources: readonly string[]) => calls.push(['invalidate', resources]),
  }
  const stop = startResourceSyncTransport(socket as never, sync as never)
  return { calls, handlers, stop, emit: (event: object) => onEvent('s', event as never) }
}

describe('resource sync transport', () => {
  test('a reconnect that replayed every missed frame tells the scheduler so', () => {
    const { calls, handlers } = harness(true)
    handlers.connected()
    expect(calls).toEqual([['connected', { replayed: true }]])
  })

  test('an open that did not resume reads everything', () => {
    const { calls } = harness(false, true)
    expect(calls).toEqual([['connected', { replayed: false }]])
  })

  test('a replay found incomplete reads everything again', () => {
    const { calls, handlers } = harness(true)
    handlers.connected()
    handlers.resync()
    expect(calls).toEqual([
      ['connected', { replayed: true }],
      ['connected', undefined],
    ])
  })

  test('replayed resource pokes still invalidate what they name', () => {
    const { calls, emit, stop } = harness(true)
    emit({ type: 'resources.changed', resources: ['providers'] })
    stop()
    expect(calls).toEqual([['invalidate', ['providers']], ['disconnected']])
  })
})
