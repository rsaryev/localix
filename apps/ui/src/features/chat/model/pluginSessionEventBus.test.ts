import { describe, expect, test } from 'bun:test'

import { pluginSessionEventBus, type PluginSessionEvent } from './pluginSessionEventBus'

/**
 * The bus is a plain broadcast; per-session ISOLATION lives at the subscriber
 * edge (a mounted view forwards an event only when it matches the session the
 * view is in). These tests lock both halves of that contract.
 */

describe('pluginSessionEventBus', () => {
  test('fans an event out to subscribers and stops after unsubscribe', () => {
    const got: PluginSessionEvent[] = []
    const off = pluginSessionEventBus.subscribe((e) => got.push(e))
    pluginSessionEventBus.publish({ sessionId: 's1', phase: 'run-started' })
    off()
    pluginSessionEventBus.publish({ sessionId: 's1', phase: 'run-completed' })
    expect(got).toEqual([{ sessionId: 's1', phase: 'run-started' }])
  })

  test('a throwing subscriber never breaks delivery to the others', () => {
    const got: string[] = []
    const offA = pluginSessionEventBus.subscribe(() => {
      throw new Error('boom')
    })
    const offB = pluginSessionEventBus.subscribe((e) => got.push(e.phase))
    pluginSessionEventBus.publish({ sessionId: 's1', phase: 'run-failed' })
    offA()
    offB()
    expect(got).toEqual(['run-failed'])
  })

  test('PER-SESSION GATE: a view forwards only its OWN session (the hook edge)', () => {
    const activeSessionId = 'active'
    const forwarded: string[] = []
    // Mirrors usePluginPanelBridge's subscriber: drop events for other sessions.
    const off = pluginSessionEventBus.subscribe((e) => {
      if (e.sessionId !== activeSessionId) return
      forwarded.push(e.sessionId)
    })
    pluginSessionEventBus.publish({ sessionId: 'background', phase: 'run-completed' })
    pluginSessionEventBus.publish({ sessionId: 'active', phase: 'run-completed' })
    off()
    expect(forwarded).toEqual(['active'])
  })
})
