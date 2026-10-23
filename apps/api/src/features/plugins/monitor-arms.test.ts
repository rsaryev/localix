import { describe, expect, test } from 'bun:test'

import { createMonitorArms } from './monitor-arms'

describe('monitor arms', () => {
  test('a line finds only the sessions armed for its monitor', () => {
    const arms = createMonitorArms()
    arms.arm('ci:builds', 'chat-1')
    arms.arm('ci:deploys', 'chat-2')
    expect(arms.sessionsFor('ci:builds')).toEqual(['chat-1'])
    expect(arms.sessionsFor('other:watch')).toEqual([])
  })

  test('a session that cannot take a wake leaves every monitor at once', () => {
    const arms = createMonitorArms()
    arms.arm('ci:builds', 'gone')
    arms.arm('ci:deploys', 'gone')
    arms.arm('ci:deploys', 'chat-2')
    arms.disarmSession('gone')
    expect(arms.sessionsFor('ci:builds')).toEqual([])
    expect(arms.sessionsFor('ci:deploys')).toEqual(['chat-2'])
  })

  test('silence is reported once per stretch, and again after the last arm leaves', () => {
    const arms = createMonitorArms()
    expect(arms.firstUnaddressed('ci:builds')).toBe(true)
    expect(arms.firstUnaddressed('ci:builds')).toBe(false)
    arms.arm('ci:builds', 'chat-1')
    expect(arms.firstUnaddressed('ci:builds')).toBe(false)
    arms.disarm('ci:builds', 'chat-1')
    expect(arms.firstUnaddressed('ci:builds')).toBe(true)
  })
})
