/**
 * A context checkpoint is this runtime's compaction: Claude Code's PreCompact and then PostCompact
 * fire with `trigger: "auto"`, the epoch cards standing for the compaction summary.
 */
import { describe, expect, test } from 'bun:test'
import type { ContextCheckpoint } from '@localixai/agent'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../../cc-hooks'
import type { ModRunScope } from '../../../../mods/run-scope'
import type { ModelView } from '../../model-view/view'
import { announceCheckpoint } from './history'
import type { RunFrame } from './frame'
import { reviewRunView } from './view'

const checkpoint = {
  cards: [
    { fromId: 'a', throughId: 'b', level: 0, text: 'Read the config.' },
    { fromId: 'c', throughId: 'd', level: 1, text: 'Fixed the parser.' },
  ],
} as unknown as ContextCheckpoint

describe('a checkpoint announced to Claude Code hooks', () => {
  test('PreCompact, then PostCompact with the cards as the summary', async () => {
    const order: string[] = []
    let done!: () => void
    const finished = new Promise<void>((resolve) => (done = resolve))
    const hooks: CcHooksRuntime = {
      ...INERT_CC_HOOKS,
      active: true,
      runPreCompact: async (trigger) => {
        order.push(`pre ${trigger}`)
        return { blocked: false }
      },
      runPostCompact: async (trigger, summary) => {
        order.push(`post ${trigger}: ${summary}`)
        done()
      },
    }
    const frame = {
      env: {
        deps: { streamRegistry: { publish: () => {} } },
        state: { ccHooksStartedSessions: new Set(), ccHooksSessionStartSource: new Map() },
      },
      userId: 'u1',
      session: { id: 's1' },
      speakerAgentId: 'a1',
      teardown: { ccHooks: hooks },
    } as unknown as RunFrame
    announceCheckpoint(frame, checkpoint)
    await finished
    expect(order).toEqual(['pre auto', 'post auto: Read the config.\n\nFixed the parser.'])
  })
})

describe('PreCompact before a checkpoint is committed', () => {
  const mods = { compaction: async () => 'keep' } as unknown as ModRunScope
  const view = (due: ModelView['due']): ModelView => ({
    viewer: 'agent:a1',
    turnContexts: new Map(),
    epochId: 'assistant-1',
    ...(due ? { due } : {}),
  })
  const hooks = (blocked: boolean): CcHooksRuntime => ({
    ...INERT_CC_HOOKS,
    active: true,
    runPreCompact: async () => (blocked ? { blocked, reason: 'saving notes' } : { blocked }),
  })

  test('a block skips a proactive checkpoint and the turn goes on uncompacted', async () => {
    const reviewed = await reviewRunView(view('threshold'), mods, hooks(true))
    expect(reviewed.due).toBeUndefined()
  })

  test('a block on a checkpoint recovering from a context-limit error fails the turn', async () => {
    await expect(reviewRunView(view('overflow'), mods, hooks(true))).rejects.toThrow('saving notes')
  })

  test('an allowed checkpoint is not announced to PreCompact a second time', async () => {
    const reviewed = await reviewRunView(view('threshold'), mods, hooks(false))
    expect(reviewed).toMatchObject({ due: 'threshold', preCompactRan: true })
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
      speakerAgentId: 'a1',
      teardown: {
        ccHooks: {
          ...INERT_CC_HOOKS,
          active: true,
          runPreCompact: async () => {
            order.push('pre')
            return { blocked: false }
          },
          runPostCompact: async () => {
            order.push('post')
            done()
          },
        },
      },
    } as unknown as RunFrame
    announceCheckpoint(frame, checkpoint, reviewed.preCompactRan === true)
    await finished
    expect(order).toEqual(['post'])
  })
})
