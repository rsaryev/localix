import { describe, expect, test } from 'bun:test'

import { bindPluginMonitors, createMonitorArms } from './monitor-arms'
import type { MonitorArmInput } from './monitor-host'

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

describe('the plugin `monitors` host service', () => {
  const bound = (owned: boolean) => {
    const armed: MonitorArmInput[] = []
    const service = bindPluginMonitors({
      pluginName: 'ci',
      host: () => ({
        arm: async (input) => {
          armed.push(input)
          return { status: 'armed' }
        },
        disarm: () => {},
      }),
      resolveSessionCwd: async () => {
        if (!owned) throw new Error('session_not_found')
        return '/work'
      },
    })
    return { service, armed }
  }

  test("arms the plugin's own monitor for a session the user owns", async () => {
    const { service, armed } = bound(true)
    expect(await service.arm({ userId: 'u1', sessionId: 'chat-1', monitor: 'builds' })).toEqual({
      status: 'armed',
    })
    expect(armed).toEqual([
      { userId: 'u1', sessionId: 'chat-1', pluginName: 'ci', monitorName: 'builds' },
    ])
  })

  test('refuses a session the user does not own, and a missing one', async () => {
    const foreign = bound(false)
    expect(
      await foreign.service.arm({ userId: 'u1', sessionId: 'theirs', monitor: 'builds' }),
    ).toEqual({ status: 'refused', reason: 'no such session for this user' })
    expect(foreign.armed).toEqual([])

    const blank = bound(true)
    expect(
      (await blank.service.arm({ userId: 'u1', sessionId: ' ', monitor: 'builds' })).status,
    ).toBe('refused')
    expect(blank.armed).toEqual([])
  })
})
