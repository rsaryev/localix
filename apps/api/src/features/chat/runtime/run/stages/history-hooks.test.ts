/**
 * A context checkpoint is this runtime's compaction: Claude Code's PreCompact and then PostCompact
 * fire with `trigger: "auto"`, the epoch cards standing for the compaction summary.
 */
import { describe, expect, test } from 'bun:test'
import type { ContextCheckpoint } from '@localixai/agent'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../../cc-hooks'
import { announceCheckpoint } from './history'
import type { RunFrame } from './frame'

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
