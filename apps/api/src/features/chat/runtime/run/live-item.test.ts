import { describe, expect, test } from 'bun:test'
import { isToolCallItem, type AgentItem } from '@localixai/agent/agents'

import { createItemAccumulator } from '../items'
import type { LiveItemResolver } from '../agent-runner-state'
import type { TurnEventContext } from './event-handlers'
import { awaitsLateOutcome, holdLiveToolItem } from './live-item'

/** The smallest run context the resolver touches: one row, its accumulator, its writes. */
function runWithQueuedAsk() {
  const acc = createItemAccumulator(() => 'Awaiting user input')
  acc.startTool(0, 'call-ask', 'ask', { questions: [] })
  acc.endTool('call-ask', 'ask', {
    status: 'completed',
    details: { queued: { questionId: 'q-1', status: 'pending' } },
  })
  const payload = { id: 'row-1', role: 'assistant' as const, items: acc.list() }
  const writes: { messageId: string; items: AgentItem[] }[] = []
  const ctx = {
    assistantMessageId: 'row-1',
    acc,
    userId: 'u1',
    session: { id: 's1' },
    liveItemResolvers: new Map<string, LiveItemResolver>(),
    runLiveResolverKeys: new Set<string>(),
    state: {
      payload,
      currentPayload: payload,
      completedTurnCheckpoint: { payload, createdAt: 't0' },
      currentTurnIndex: 0,
      lastSent: {},
      lastDbFlushAt: 0,
      assistantCreatedAt: 't0',
    },
    env: {
      persistAndPublish: async (_u: string, _s: string, messageId: string, p: typeof payload) => {
        writes.push({ messageId, items: p.items })
      },
    },
  } as unknown as TurnEventContext
  return { ctx, acc, writes }
}

const askOutput = (items: readonly AgentItem[] | undefined) =>
  items?.find((item) => isToolCallItem(item) && item.toolCallId === 'call-ask') as
    | { output?: unknown }
    | undefined

describe('holdLiveToolItem', () => {
  test('a late outcome lands in what the run writes next — accumulator, payload and checkpoint', async () => {
    const { ctx, acc, writes } = runWithQueuedAsk()
    holdLiveToolItem(ctx, 'call-ask')
    expect(ctx.runLiveResolverKeys.has('call-ask')).toBe(true)

    const details = { queued: { questionId: 'q-1', status: 'answered' }, answers: [] }
    expect(ctx.liveItemResolvers.get('call-ask')!({ details })).toBe(true)

    // The run's own next flush rebuilds from the accumulator: it must carry the answer, or it
    // would write the "waiting" card back over it.
    expect(askOutput(acc.list())?.output).toEqual(details)
    expect(askOutput(ctx.state.currentPayload.items)?.output).toEqual(details)
    // A steering split re-persists the checkpoint as the sealed first row.
    expect(askOutput(ctx.state.completedTurnCheckpoint?.payload.items)?.output).toEqual(details)
    await Promise.resolve()
    expect(writes.map((w) => w.messageId)).toEqual(['row-1'])
  })

  test('declines once a split moved the run to a fresh row — the sealed row is the caller’s', () => {
    const { ctx } = runWithQueuedAsk()
    holdLiveToolItem(ctx, 'call-ask')
    // What `splitAssistantRowForSteer` does: re-point the run and empty its accumulator.
    ctx.assistantMessageId = 'row-2'
    ctx.acc.reset()
    expect(ctx.liveItemResolvers.get('call-ask')!({ details: {} })).toBe(false)
    // Nothing was re-created inside the new row.
    expect(ctx.acc.list()).toEqual([])
  })
})

describe('awaitsLateOutcome', () => {
  test('only a queued ask has an outcome still to come', () => {
    expect(awaitsLateOutcome('ask', { queued: { questionId: 'q-1' } })).toBe(true)
    expect(awaitsLateOutcome('ask', { request: {}, answers: [] })).toBe(false)
    expect(awaitsLateOutcome('bash', { queued: true })).toBe(false)
  })
})
