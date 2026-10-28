/**
 * The stages that run over PERSISTED rows, before anything is turned into a model payload.
 *
 *   1. `clear-cut`    — honour `/clear` and topic boundaries, which cut by position. LOAD-BEARING: if
 *                       this rule fails to apply, the model is re-sent a conversation the user
 *                       cleared, so a throw here must stop the turn, never pass through.
 *   2. `turn-context` — put every past turn's runtime context back where it was sent, and append
 *                       this turn's. Replaying the stored text in place is what keeps the history
 *                       append-only: a context rebuilt per turn and dropped on the next rewrote
 *                       history the model had already seen (prefix cache, preserved thinking).
 *
 * `agent-history` runs between them (its own file): turn contexts are private to the agent's
 * runs, so they are inserted into its projection, never before it.
 */
import type { HistoryStage } from '@localixai/agent/history'

import { SYSTEM_AUTHOR } from '../../../../../db'
import type { PersistedMessage } from '../../../contracts'
import type { StoredTurnContext } from '../../model-view/turn-context'
import { rowsAfterClear } from '../../model-view/view'

export function clearCutStage(): HistoryStage<PersistedMessage> {
  return {
    name: 'clear-cut',
    run: (messages) => {
      const { rows } = rowsAfterClear(messages as PersistedMessage[])
      const kept = new Set(rows.map((m) => m.id))
      return {
        messages: rows,
        dropped: messages
          .filter((m) => !kept.has(m.id))
          .map((m) => ({ reason: 'boundary' as const, messageId: m.id })),
      }
    },
  }
}

const TURN_CONTEXT_PREFIX = 'turn-context-'

/** The row a stored turn context is shown as, identified by the run that sent it. */
export function turnContextRow(
  context: StoredTurnContext,
  owner: Pick<PersistedMessage, 'id' | 'sessionId' | 'userId' | 'createdAt'>,
): PersistedMessage {
  const id = `${TURN_CONTEXT_PREFIX}${owner.id}`
  return {
    id,
    sessionId: owner.sessionId,
    userId: owner.userId,
    createdAt: owner.createdAt,
    updatedAt: owner.createdAt,
    payload: {
      id,
      role: 'user',
      from: SYSTEM_AUTHOR,
      content: context.content,
      isInternal: true,
      ...(context.bindings?.length ? { bindings: context.bindings } : {}),
    },
  }
}

export const isTurnContextRow = (message: Pick<PersistedMessage, 'id'>) =>
  message.id.startsWith(TURN_CONTEXT_PREFIX)

export function turnContextStage(input: {
  /** The viewer's stored contexts, by the assistant row that sent them. */
  past: ReadonlyMap<string, StoredTurnContext>
  /** This turn's context, shown last; absent when it has nothing to say. */
  current?: { context: StoredTurnContext; owner: Parameters<typeof turnContextRow>[1] }
}): HistoryStage<PersistedMessage> {
  return {
    name: 'turn-context',
    run: (messages) => {
      const out: PersistedMessage[] = []
      for (const message of messages as PersistedMessage[]) {
        const context = input.past.get(message.id)
        if (context) out.push(turnContextRow(context, message))
        out.push(message)
      }
      if (input.current) out.push(turnContextRow(input.current.context, input.current.owner))
      return { messages: out }
    },
  }
}
