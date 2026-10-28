/**
 * `/compact` asks for a checkpoint by hand: Claude Code's PreCompact and PostCompact hooks hear it
 * as trigger `manual`, and PreCompact receives the instructions the person typed.
 */
import { describe, expect, test } from 'bun:test'
import type { ContextCheckpoint } from '@localixai/agent'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../../cc-hooks'
import type { ModRunScope } from '../../../../mods/run-scope'
import { loadModelView, type ModelView } from '../../model-view/view'
import type { ModelContextRepository } from '../../../model-context-repository'
import { announceCheckpoint } from './history'
import type { RunFrame } from './frame'
import { reviewRunView } from './view'

const manual = { instructions: 'keep the plan' }
const checkpoint = {
  cards: [{ fromId: 'a', throughId: 'b', level: 0, text: 'Read the config.' }],
} as unknown as ContextCheckpoint

describe('a manual compaction and the hooks', () => {
  test('the view takes a checkpoint although nothing was measured, and keeps the request', async () => {
    const repo = {
      list: async () => new Map(),
      getCheckpoint: async () => undefined,
    } as unknown as ModelContextRepository
    const view = await loadModelView(repo, {
      sessionId: 's1',
      viewer: 'agent:a1',
      historyMessages: [],
      currentMessageId: 'assistant-1',
      manual,
    })
    expect(view).toMatchObject({ due: 'threshold', manual, epochId: 'assistant-1' })
  })

  test('PreCompact hears trigger manual with the instructions, before the checkpoint', async () => {
    const calls: unknown[][] = []
    const hooks: CcHooksRuntime = {
      ...INERT_CC_HOOKS,
      active: true,
      runPreCompact: async (...args) => {
        calls.push(args)
        return { blocked: false }
      },
    }
    const view: ModelView = {
      viewer: 'agent:a1',
      turnContexts: new Map(),
      epochId: 'assistant-1',
      due: 'threshold',
      manual,
    }
    const mods = { compaction: async () => 'keep' } as unknown as ModRunScope
    const reviewed = await reviewRunView(view, mods, hooks)
    expect(calls).toEqual([['manual', 'keep the plan']])
    expect(reviewed.preCompactRan).toBe(true)
  })

  test('PostCompact follows with trigger manual', async () => {
    const order: string[] = []
    let done!: () => void
    const finished = new Promise<void>((resolve) => (done = resolve))
    const frame = {
      env: {
        deps: { streamRegistry: { publish: () => {} } },
        state: { ccHooksStartedSessions: new Set(), ccHooksSessionStartSource: new Map() },
      },
      userId: 'u1',
      session: { id: 's1' },
      agentId: 'a1',
      teardown: {
        ccHooks: {
          ...INERT_CC_HOOKS,
          active: true,
          runPostCompact: async (trigger: string) => {
            order.push(`post ${trigger}`)
            done()
          },
        },
      },
    } as unknown as RunFrame
    announceCheckpoint(frame, checkpoint, true, manual)
    await finished
    expect(order).toEqual(['post manual'])
  })
})
