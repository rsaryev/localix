/**
 * CHECKPOINT: show the history through the checkpoint in force — or, on the turn one is due,
 * take the new one and show the history through that.
 *
 * Between checkpoints this stage only APPLIES a frozen record (`projectCheckpoint`), which is
 * what makes the history append-only: the same rows and the same record give the same bytes on
 * every turn, and everything newer than the record passes untouched. On a due turn it plans
 * (`planCheckpoint`) — deterministically, without a model call — and hands the new record back
 * for the run to persist before the request goes out, so the next turn rebuilds this view.
 *
 * The turn's own runtime context is the last payload and is never part of what a checkpoint
 * covers: it belongs to the run that is starting, and it is priced into the target instead.
 */
import {
  estimateChatMessageTokens,
  planCheckpoint,
  projectCheckpoint,
  type CheckpointEntry,
  type CheckpointReason,
  type ContextCheckpoint,
} from '@localixai/agent'
import type { HistoryStage } from '@localixai/agent/history'

import { SYSTEM_AUTHOR } from '../../../../../db'
import type { StoredMessagePayload } from '../../../../../db/payload'
import type { PersistedMessage } from '../../../contracts'
import { MODEL_TRIM_KEEP_RECENT, resolveKeepRecentTokens } from '../../agent-runner-constants'
import type { ContextBudgetFrame } from '../../context-budget'
import { CHECKPOINT_CARD_SHARE, checkpointTargetTokens } from '../../model-view/checkpoint-policy'
import { isTurnContextRow } from './persisted'

export interface CheckpointStageInput {
  frame: ContextBudgetFrame
  /** The rows the payloads were derived from, one to one and in order. */
  rows: readonly PersistedMessage[]
  /** The checkpoint in force, and the assistant row that hosts it. */
  inForce?: { hostId: string; record: ContextCheckpoint }
  /** Set when this turn takes a checkpoint; `hostId` is the run's own assistant row. */
  due?: { reason: CheckpointReason; hostId: string }
  /** Whether the last payload is this turn's runtime context (never covered). */
  endsWithTurnContext: boolean
  /** Index of the active invocation among the rows, or -1. */
  activeInvocationIndex: number
  flags: { recoveryToolAvailable: boolean; recallToolAvailable: boolean }
  /** Receives the record a due turn took, for the run to persist. */
  onCheckpoint: (checkpoint: ContextCheckpoint) => void
}

function entriesOf(
  payloads: readonly StoredMessagePayload[],
  rows: readonly PersistedMessage[],
): CheckpointEntry<StoredMessagePayload>[] {
  return payloads.map((payload, index) => {
    const row = rows[index]!
    const turnContext = isTurnContextRow(row)
    return {
      message: payload,
      turnStart: payload.role === 'user' && !turnContext,
      internal: payload.isInternal === true || turnContext,
      ...(payload.origin === 'delegator' && !turnContext ? { assignmentUpdate: true } : {}),
      pinned: payload.pinned === true,
      createdAt: row.createdAt,
    }
  })
}

const cardsRow =
  (hostId: string) =>
  (text: string): StoredMessagePayload => ({
    id: `context-checkpoint-${hostId}`,
    role: 'user',
    from: SYSTEM_AUTHOR,
    content: text,
    isInternal: true,
  })

export function checkpointStage(input: CheckpointStageInput): HistoryStage<StoredMessagePayload> {
  return {
    name: 'checkpoint',
    run: (messages) => {
      const payloads = messages as StoredMessagePayload[]
      const split = input.endsWithTurnContext ? payloads.length - 1 : payloads.length
      const covered = entriesOf(payloads.slice(0, split), input.rows)
      const appended = payloads.slice(split)
      if (covered.length === 0) return { messages: payloads }

      let record = input.inForce?.record
      let hostId = input.inForce?.hostId
      if (input.due) {
        const target = checkpointTargetTokens(
          input.frame,
          appended.reduce((sum, m) => sum + estimateChatMessageTokens(m), 0),
        )
        record = planCheckpoint({
          entries: covered,
          ...(record ? { previous: record } : {}),
          reason: input.due.reason,
          targetTokens: target,
          activeFromIndex:
            input.activeInvocationIndex >= 0 && input.activeInvocationIndex < covered.length
              ? input.activeInvocationIndex
              : covered.length,
          keepRecentCount: MODEL_TRIM_KEEP_RECENT,
          keepRecentTokens: Math.min(
            resolveKeepRecentTokens(input.frame.effectiveWindow),
            Math.floor(target / 2),
          ),
          cardBudgetTokens: Math.floor(target * CHECKPOINT_CARD_SHARE),
          flags: input.flags,
        })
        hostId = input.due.hostId
        input.onCheckpoint(record)
      }
      if (!record || !hostId) return { messages: payloads }
      const view = projectCheckpoint(covered, record, { cardsMessage: cardsRow(hostId) })
      return { messages: [...view, ...appended] }
    },
  }
}
