/**
 * Model switches and project moves a person makes between turns fire the session's hooks:
 * PreModelSwitch may refuse before anything is written, PostModelSwitch leaves context for the
 * next request, CwdChanged may name files to watch.
 */
import { describe, expect, test } from 'bun:test'

import { INERT_CC_HOOKS, type CcHooksRuntime, type CcModelSwitch } from '../../cc-hooks'
import { createCcHookSessions } from '../runtime/cc-hook-sessions'
import {
  announceCwdChange,
  announceModelSwitches,
  guardModelSwitches,
  modelSwitchRefusal,
  modelSwitches,
} from './cc-session-events'

/** Hook sessions whose `s1` fires the given runtime. */
function sessionsWith(runtime: Partial<CcHooksRuntime>) {
  const sessions = createCcHookSessions()
  const hooks: CcHooksRuntime = {
    ...INERT_CC_HOOKS,
    active: true,
    hasHooks: () => true,
    ...runtime,
  }
  return Object.assign(sessions, { runtimeFor: () => hooks })
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('model switch hooks', () => {
  const current = { modelId: 'claude-sonnet-5' }

  test('only a route that moves to another model is a switch', () => {
    expect(modelSwitches(current, { modelId: 'claude-opus-5' })).toEqual([
      { fromModel: 'claude-sonnet-5', toModel: 'claude-opus-5' },
    ])
    expect(modelSwitches(current, { modelId: 'claude-sonnet-5' })).toEqual([])
    expect(modelSwitches(current, {})).toEqual([])
  })

  test('a PreModelSwitch deny or ask refuses the request before it is written', async () => {
    const seen: CcModelSwitch[] = []
    const hooks = sessionsWith({
      runPreModelSwitch: async (change) => {
        seen.push(change)
        return { decision: 'deny', reason: 'Opus 4.6 is retired' }
      },
    })
    const change = { fromModel: 'a', toModel: 'claude-opus-4-6', requestedModel: 'opus' }
    expect(await modelSwitchRefusal(hooks, 's1', [change], 'command')).toBe('Opus 4.6 is retired')
    expect(seen).toEqual([{ ...change, source: 'command' }])
    await expect(guardModelSwitches(hooks, 's1', [change], 'picker')).rejects.toThrow('retired')
    const asking = sessionsWith({ runPreModelSwitch: async () => ({ decision: 'ask' }) })
    expect(await modelSwitchRefusal(asking, 's1', [change], 'picker')).toContain('blocked')
  })

  test("PostModelSwitch context waits for the next request; the last switch's wins", async () => {
    const hooks = sessionsWith({
      runPostModelSwitch: async (change) => ({ additionalContext: `now on ${change.toModel}` }),
    })
    const changes = [
      { fromModel: 'a', toModel: 'b' },
      { fromModel: 'b', toModel: 'c' },
    ]
    announceModelSwitches(hooks, 's1', changes, 'picker')
    await settle()
    expect(hooks.takeContext('s1')).toBe('now on c')
  })
})

describe('CwdChanged', () => {
  test('a project move reports both directories and adopts the watch list it returns', async () => {
    const seen: string[][] = []
    const hooks = sessionsWith({
      runCwdChanged: async (from, to) => {
        seen.push([from, to])
        return { watchPaths: ['/new/.envrc'] }
      },
    })
    const watched: string[][] = []
    hooks.setWatchPaths = (_id, paths) => void watched.push([...paths])
    announceCwdChange(hooks, 's1', '/old', '/new')
    announceCwdChange(hooks, 's1', '/same', '/same')
    await settle()
    expect(seen).toEqual([['/old', '/new']])
    expect(watched).toEqual([['/new/.envrc']])
  })
})
