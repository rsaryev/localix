/**
 * Split the run's assistant row at a mid-run steering point.
 *
 * The transcript stores ONE assistant row per run, created at run start — so a user
 * message steered into the run lands AFTER that still-growing row by sequence, and
 * everything the model wrote in REACTION to it renders (and re-reads, on later runs)
 * as if it came before the instruction. The fix is the one the original analysis
 * called for: END the current assistant row at the injection point, insert the user
 * turn, and START a new assistant row for the rest of the run — the transcript then
 * reads `assistant part 1 → user steer → assistant part 2`, chronologically true for
 * the UI, the next run's model view, and a checkpoint's turn boundaries alike.
 *
 * Row-scoped accounting resets with the row: part 1 keeps the usage/timing its last
 * `message_end` upsert recorded (each part's ledger row carries only its own turns —
 * no double count), part 1's timing folds into the session base so session totals
 * stay continuous, and the item accumulator starts empty for part 2.
 *
 * Called from the loop's `steeringMessages` callback, i.e. at a TURN BOUNDARY: the
 * previous turn's `message_end` has already persisted part 1, and no event is in
 * flight for it. The split happens even when the current row is still EMPTY (a steer
 * in the instant before the first model response): that empty slot predates the
 * instruction by sequence, so leaving it would again put the response before the user
 * turn that shaped it — the order the loop emits (steer, then the assistant message) is
 * the order stored. The user row and the fresh assistant row commit in one transaction.
 */
import { randomUUID } from 'node:crypto'

import { addMessageTiming } from '../../session-timing'
import { emptyAssistantPayload, sessionAgent, toPersistedMessage } from '../message-envelope'
import { zeroUsageTotals } from '../usage-normalize'
import type { TurnEventContext } from './event-handlers'
import type { PersistedMessage } from '../../contracts'

export async function splitAssistantRowForSteer(
  ctx: TurnEventContext,
  turn?: { userMessage: PersistedMessage; assistantMessageId: string },
): Promise<void> {
  const { env, userId, session, state } = ctx
  // A failed queue acknowledgement may redeliver the already-committed pair.
  if (turn && ctx.assistantMessageId === turn.assistantMessageId) return
  const timestamp = env.now()

  // Part 1 is already persisted (the previous turn's message_end upserted it); it
  // simply stops receiving events. Fresh assistant row — part 2 — with the same
  // envelope+insert+publish trio as run start.
  const payload = emptyAssistantPayload(
    turn?.assistantMessageId ?? randomUUID(),
    sessionAgent(session),
  )
  if (turn) payload.continuedFromMessageId = ctx.assistantMessageId
  const message = toPersistedMessage(userId, session.id, payload, timestamp)
  const rows = turn ? [turn.userMessage, message] : [message]
  if (turn && state.completedTurnCheckpoint) {
    // Tool-end snapshots may only have been streamed since the last DB flush.
    // Seal the completed prefix before handing its ownership to another row.
    await env.persistAndPublish(
      userId,
      session.id,
      ctx.assistantMessageId,
      state.completedTurnCheckpoint.payload,
      state.completedTurnCheckpoint.createdAt,
    )
  }
  // One transaction, in causal order, as for ordinary turn entry. No partial
  // user delivery or response-before-instruction survives a failed write.
  if (turn) await env.repo.insertMessages(rows)
  else await env.repo.insertMessage(message)
  for (const row of rows) {
    env.deps.streamRegistry.publish(userId, session.id, {
      type: 'message.created',
      sessionId: session.id,
      message: row,
    })
  }
  // Fold part 1's timing into the session base so the session aggregate stays
  // continuous while part 2 accounts only for itself.
  state.baseSessionTiming = addMessageTiming(state.baseSessionTiming, {
    ...state.timing,
    tools: [...state.timing.tools],
  })

  // Re-point the run at the new row. Every handler reads these off the shared ctx,
  // so all subsequent events accumulate and persist into part 2.
  ctx.assistantMessageId = payload.id
  state.assistantCreatedAt = timestamp
  state.payload = payload
  state.currentPayload = payload
  // A checkpoint belongs to the row that just ended. Carrying it into part 2
  // could make overflow recovery overwrite the fresh row with part 1's payload.
  state.completedTurnCheckpoint = undefined
  ctx.acc.reset()

  // Row-scoped accounting starts over: the usage ledger upserts by message id, so
  // without this part 2's rows would re-carry part 1's totals (a double count).
  state.usageTotals = zeroUsageTotals()
  state.actualCostSum = 0
  state.estimatedCostSum = 0
  state.turnsWithUsage = 0
  state.turnsWithActualCost = 0
  state.lastTurnContextTokens = undefined
  state.lastTurnUsage = undefined
  const nowMs = Date.now()
  state.timing = {
    modelMs: 0,
    revealMs: 0,
    ttftMs: undefined,
    toolGenMs: 0,
    waitMs: 0,
    toolMs: 0,
    hitlMs: 0,
    idleMs: 0,
    totalMs: 0,
    turns: 0,
    tools: [],
  }
  state.runStartedAt = nowMs
  state.turnStartedAt = nowMs
  state.turnFirstTokenAt = undefined
  state.turnToolGenAt = undefined
  // Streaming dedup state is per-row: a fresh row must not suppress its first delta
  // because part 1 already sent identical text.
  state.lastSent = {
    text: '',
    reasoning: '',
    items: undefined,
    textItemId: '',
    reasoningItemId: '',
  }
  state.lastDbFlushAt = 0
}
