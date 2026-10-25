import { describe, expect, test } from 'bun:test'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../cc-hooks'
import type { SessionRecord } from '../../repository'
import { runStopHooks } from './finalize-stop-hooks'

type Call = { event: 'Stop' | 'SubagentStop'; args: unknown[] }

/** A runtime that records which end-of-turn event fired, and blocks it when asked to. */
function hooks(block: { stop?: string; subagentStop?: string } = {}) {
  const calls: Call[] = []
  const ccHooks: CcHooksRuntime = {
    ...INERT_CC_HOOKS,
    active: true,
    async runStop(...args) {
      calls.push({ event: 'Stop', args })
      return block.stop ? { blocked: true, reason: block.stop } : { blocked: false }
    },
    async runSubagentStop(...args) {
      calls.push({ event: 'SubagentStop', args })
      return block.subagentStop ? { blocked: true, reason: block.subagentStop } : { blocked: false }
    },
  }
  return { ccHooks, calls }
}

const delegated = (agentType?: string) =>
  ({
    id: 'child',
    provenance: {
      kind: 'task-delegation',
      parentSessionId: 'parent',
      toolCallId: 'call-1',
      priority: 'normal',
      depth: 1,
      chain: ['builtin:localix'],
      ...(agentType ? { agentType } : {}),
    },
  }) as unknown as SessionRecord
const root = { id: 'chat', provenance: { kind: 'root' } } as unknown as SessionRecord
const scope = { speakerAgentId: 'builtin:localix' }

describe('the end-of-turn hooks', () => {
  test('a delegated child fires SubagentStop, from every source, and never Stop', async () => {
    const { ccHooks, calls } = hooks()
    const reason = await runStopHooks({
      ccHooks,
      session: delegated('sec:reviewer'),
      scope,
      stopHookActive: false,
      content: 'Done.',
    })
    expect(reason).toBeUndefined()
    // No `sourcesOnly`: plugin and settings SubagentStop hooks reach the child's own end.
    expect(calls).toEqual([
      {
        event: 'SubagentStop',
        args: ['sec:reviewer', 'child', 'Done.', { stopHookActive: false }],
      },
    ])
  })

  test('a SubagentStop block keeps the child working with its reason', async () => {
    const { ccHooks } = hooks({ subagentStop: 'Run the tests first.', stop: 'never asked' })
    const reason = await runStopHooks({
      ccHooks,
      session: delegated(),
      scope,
      stopHookActive: true,
      content: null,
    })
    expect(reason).toBe('Run the tests first.')
  })

  test('the main agent fires Stop, and its block is the reason to continue', async () => {
    const { ccHooks, calls } = hooks({ stop: 'Not done yet.' })
    const reason = await runStopHooks({
      ccHooks,
      session: root,
      scope,
      stopHookActive: false,
      content: 'Done.',
    })
    expect(reason).toBe('Not done yet.')
    expect(calls.map((call) => call.event)).toEqual(['Stop'])
  })

  test('a run a hook ended (continue:false) fires no Stop or SubagentStop and never continues', async () => {
    for (const session of [root, delegated()]) {
      const { ccHooks, calls } = hooks({ stop: 'Keep working.', subagentStop: 'Keep working.' })
      const reason = await runStopHooks({
        ccHooks: { ...ccHooks, stoppedBy: () => ({ event: 'PreToolUse', reason: 'Build failed' }) },
        session,
        scope,
        stopHookActive: false,
        content: null,
      })
      expect(reason).toBeUndefined()
      expect(calls).toEqual([])
    }
  })
})
