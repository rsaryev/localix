import { sessionFixture } from '../../../../testing/session-fixture'
import { USER_AUTHOR } from '../../../../db'
/**
 * The steer SPLIT: ending the run's assistant row at the injection point and starting
 * a fresh one is what makes a steered transcript read chronologically —
 * `assistant part 1 → user steer → assistant part 2` — instead of the steer trailing a
 * row that kept growing after it.
 *
 * Row-scoped accounting must reset with the row (the usage ledger upserts by message
 * id — carrying part 1's totals into part 2's rows double-counts), while part 1's
 * timing folds into the session base so session totals stay continuous.
 */
import { describe, expect, it } from 'bun:test'

import { splitAssistantRowForSteer } from './steer-split'
import { createRunTurnState } from './turn-state'
import { createItemAccumulator } from '../items'
import { emptyAssistantPayload } from '../message-envelope'
import { emptySessionTiming } from '../../session-timing'
import type { TurnEventContext } from './event-handlers'
import type { PersistedMessage } from '../../contracts'
import type { SessionRecord } from '../../repository'
import { DEFAULT_AGENT_AUTHOR } from '../../../../db'

function makeCtx() {
  const inserted: PersistedMessage[] = []
  const published: Array<{ type: string }> = []
  const state = createRunTurnState({
    payload: emptyAssistantPayload('row-1', DEFAULT_AGENT_AUTHOR),
    assistantCreatedAt: '2026-07-10 00:00:00',
    baseSessionTiming: emptySessionTiming(),
  })
  const acc = createItemAccumulator(() => 'Running')
  const ctx = {
    env: {
      now: () => '2026-07-10 00:05:00',
      repo: {
        insertMessage: async (m: PersistedMessage) => void inserted.push(m),
        insertMessages: async (rows: PersistedMessage[]) => void inserted.push(...rows),
      },
      persistAndPublish: async () => {},
      deps: {
        streamRegistry: {
          publish: (_u: string, _s: string, e: { type: string }) => void published.push(e),
        },
      },
    },
    userId: 'u1',
    session: { ...sessionFixture(), id: 's1' } as SessionRecord,
    assistantMessageId: 'row-1',
    state,
    acc,
  } as unknown as TurnEventContext
  return { ctx, state, acc, inserted, published }
}

describe('splitAssistantRowForSteer', () => {
  const userMessage: PersistedMessage = {
    id: 'steer-user',
    userId: 'u1',
    sessionId: 's1',
    payload: {
      id: 'steer-user',
      role: 'user',
      from: USER_AUTHOR,
      content: 'change direction',
    },
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
  }

  it('commits an ordered pair even before the first response, and redelivery is inert', async () => {
    const { ctx, inserted } = makeCtx()
    const turn = { userMessage, assistantMessageId: 'steer-assistant' }
    await splitAssistantRowForSteer(ctx, turn)
    ctx.state.currentPayload.content = 'already answering'
    await splitAssistantRowForSteer(ctx, turn)
    expect(inserted.map((row) => row.payload.role)).toEqual(['user', 'assistant'])
    expect(ctx.state.currentPayload.content).toBe('already answering')
    expect(inserted[1]?.payload.continuedFromMessageId).toBe('row-1')
  })

  it('marks a subagent update as a continuation of the same execution', async () => {
    const { ctx, inserted } = makeCtx()
    await splitAssistantRowForSteer(ctx, {
      userMessage: {
        ...userMessage,
        payload: { ...userMessage.payload, isInternal: true, origin: 'subagent' },
      },
      assistantMessageId: 'after-report',
    })
    expect(inserted.map((row) => row.payload.role)).toEqual(['user', 'assistant'])
    expect(inserted[1]?.payload.continuedFromMessageId).toBe('row-1')
    expect(ctx.state.currentPayload.continuedFromMessageId).toBe('row-1')
  })

  it('a failed transaction cannot reset the accumulator, timing or current response', async () => {
    const { ctx, inserted, published } = makeCtx()
    ctx.acc.text(0, 'settled work')
    ctx.state.timing.toolMs = 25
    ctx.env.repo.insertMessages = async () => {
      throw new Error('write failed')
    }
    await expect(
      splitAssistantRowForSteer(ctx, { userMessage, assistantMessageId: 'next' }),
    ).rejects.toThrow('write failed')
    expect(ctx.assistantMessageId).toBe('row-1')
    expect(ctx.acc.isEmpty).toBe(false)
    expect(ctx.state.baseSessionTiming.toolMs).toBe(0)
    expect(inserted).toHaveLength(0)
    expect(published).toHaveLength(0)
  })
  it('re-points the run at a fresh persisted+published assistant row', async () => {
    const { ctx, inserted, published } = makeCtx()
    await splitAssistantRowForSteer(ctx)

    expect(inserted).toHaveLength(1)
    expect(inserted[0].payload.role).toBe('assistant')
    expect(inserted[0].payload.continuedFromMessageId).toBeUndefined()
    expect(ctx.assistantMessageId).toBe(inserted[0].id)
    expect(ctx.assistantMessageId).not.toBe('row-1')
    expect(ctx.state.currentPayload.id).toBe(inserted[0].id)
    expect(published.some((e) => e.type === 'message.created')).toBe(true)
  })

  it('part 2 starts with an empty item accumulator and empty payload', async () => {
    const { ctx, acc, state } = makeCtx()
    acc.text(0, 'part one narrative')
    state.currentPayload = { ...state.currentPayload, content: 'part one narrative' }
    await splitAssistantRowForSteer(ctx)
    expect(acc.isEmpty).toBe(true)
    expect(state.currentPayload.content).toBe('')
  })

  it("does not carry part 1's overflow checkpoint into the fresh row", async () => {
    const { ctx, state } = makeCtx()
    state.completedTurnCheckpoint = {
      payload: { ...state.currentPayload, content: 'part one' },
      createdAt: state.assistantCreatedAt,
    }
    await splitAssistantRowForSteer(ctx)
    expect(state.completedTurnCheckpoint).toBeUndefined()
  })

  it('row-scoped usage resets — the ledger must not double-count part 1', async () => {
    const { ctx, state } = makeCtx()
    state.usageTotals.inputTokens = 5000
    state.turnsWithUsage = 3
    state.actualCostSum = 0.12
    state.estimatedCostSum = 0.34
    await splitAssistantRowForSteer(ctx)
    expect(state.usageTotals.inputTokens).toBe(0)
    expect(state.turnsWithUsage).toBe(0)
    expect(state.actualCostSum).toBe(0)
    expect(state.estimatedCostSum).toBe(0)
  })

  it("part 1's timing folds into the session base — session totals stay continuous", async () => {
    const { ctx, state } = makeCtx()
    state.timing.modelMs = 4000
    state.timing.toolMs = 1500
    state.timing.totalMs = 6000
    await splitAssistantRowForSteer(ctx)
    expect(state.baseSessionTiming.modelMs).toBe(4000)
    expect(state.baseSessionTiming.toolMs).toBe(1500)
    expect(state.timing.modelMs).toBe(0) // part 2 accounts only for itself
  })

  it('streaming dedup state is per-row: a fresh row must not suppress its first delta', async () => {
    const { ctx, state } = makeCtx()
    state.lastSent = {
      text: 'sent',
      reasoning: 'r',
      items: [],
      textItemId: 'text-1',
      reasoningItemId: 'r-1',
    }
    await splitAssistantRowForSteer(ctx)
    expect(state.lastSent.text).toBe('')
  })
})
