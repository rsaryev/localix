import { describe, expect, test } from 'bun:test'

import { miniAppSessionEventBus, type MiniAppSessionEvent } from './miniAppSessionEventBus'

/**
 * The bus is a plain broadcast; per-session ISOLATION lives at the subscriber
 * edge (a mounted view forwards an event only when it matches the session the
 * view is in). These tests lock both halves of that contract.
 */

describe('miniAppSessionEventBus', () => {
  test('fans an event out to subscribers and stops after unsubscribe', () => {
    const got: MiniAppSessionEvent[] = []
    const off = miniAppSessionEventBus.subscribe((e) => got.push(e))
    miniAppSessionEventBus.publish({ sessionId: 's1', phase: 'run-started' })
    off()
    miniAppSessionEventBus.publish({ sessionId: 's1', phase: 'run-completed' })
    expect(got).toEqual([{ sessionId: 's1', phase: 'run-started' }])
  })

  test('a throwing subscriber never breaks delivery to the others', () => {
    const got: string[] = []
    const offA = miniAppSessionEventBus.subscribe(() => {
      throw new Error('boom')
    })
    const offB = miniAppSessionEventBus.subscribe((e) => got.push(e.phase))
    miniAppSessionEventBus.publish({ sessionId: 's1', phase: 'run-failed' })
    offA()
    offB()
    expect(got).toEqual(['run-failed'])
  })

  test('PER-SESSION GATE: a view forwards only its OWN session (the hook edge)', () => {
    const activeSessionId = 'active'
    const forwarded: string[] = []
    // Mirrors usePluginPanelBridge's subscriber: drop events for other sessions.
    const off = miniAppSessionEventBus.subscribe((e) => {
      if (e.sessionId !== activeSessionId) return
      forwarded.push(e.sessionId)
    })
    miniAppSessionEventBus.publish({ sessionId: 'background', phase: 'run-completed' })
    miniAppSessionEventBus.publish({ sessionId: 'active', phase: 'run-completed' })
    off()
    expect(forwarded).toEqual(['active'])
  })
})
