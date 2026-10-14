/**
 * LET A LATE OUTCOME REACH A TOOL ITEM WITHOUT RACING THE RUN THAT WRITES IT.
 *
 * Some calls return before their outcome exists: a queued question (`ask` with `wait: false`)
 * returns its id at once and is answered whenever the person looks. When that answer lands while
 * the run that asked is still going, writing the stored row loses: the run keeps the item in its
 * accumulator and re-writes the whole row on its next flush, so the patch is overwritten with the
 * old "waiting" item and the card never shows its answer. That is the race `liveItemResolvers`
 * exists for; this registers one for an item, keyed by its tool call.
 *
 * The resolver patches the item where the run will write it next — the accumulator, the current
 * payload, and the completed-turn checkpoint (a steering split re-persists that checkpoint as the
 * sealed first row, which would otherwise carry the old item back). It DECLINES once the run no
 * longer owns the row (a split moved the run to a fresh one): the item then lives only in the
 * sealed row, which nothing re-writes, and the caller patches that stored row. The run's teardown
 * deregisters it (`run-teardown.ts`), after which the stored row is the only copy.
 */
import { isToolBackedItem, type AgentItem } from '@localixai/agent/agents'

import { TOOL } from '../../../agent-core/tool-names'
import type { LiveItemResolver } from '../agent-runner-state'
import type { TurnEventContext } from './event-handlers'
import { persistNow } from './event-handlers-flush'

/** Does this finished call's item still have an outcome to come? Today: a queued question. */
export function awaitsLateOutcome(toolName: string, details: unknown): boolean {
  return (
    toolName === TOOL.ask &&
    typeof details === 'object' &&
    details !== null &&
    Boolean((details as { queued?: unknown }).queued)
  )
}

export function holdLiveToolItem(ctx: TurnEventContext, toolCallId: string): void {
  const ownedRow = ctx.assistantMessageId
  const resolver: LiveItemResolver = (patch) => {
    if (ctx.assistantMessageId !== ownedRow) return false
    if (!ctx.acc.patchToolItem(toolCallId, patch)) return false
    const { state } = ctx
    state.payload = { ...state.payload, items: ctx.acc.list() }
    state.currentPayload = state.payload
    const checkpoint = state.completedTurnCheckpoint
    if (checkpoint) {
      const items = checkpoint.payload.items?.map((item: AgentItem) =>
        isToolBackedItem(item) && item.toolCallId === toolCallId
          ? (state.payload.items?.find(
              (next) => isToolBackedItem(next) && next.toolCallId === toolCallId,
            ) ?? item)
          : item,
      )
      state.completedTurnCheckpoint = { ...checkpoint, payload: { ...checkpoint.payload, items } }
    }
    void persistNow(ctx, state.payload).catch((error: unknown) =>
      console.warn('[agent-runner] failed to persist a late tool-item outcome', error),
    )
    return true
  }
  ctx.liveItemResolvers.set(toolCallId, resolver)
  ctx.runLiveResolverKeys.add(toolCallId)
}
