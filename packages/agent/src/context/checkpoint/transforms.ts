/**
 * THE ONE PLACE a kept message's view is computed — by the planner, to price the view it is
 * choosing, and by the projection, to show it on every later turn. Two copies of this rule
 * would let the priced view and the shown view drift, and the whole point of a checkpoint is
 * that the view it paid for is the view the model gets, byte for byte, until the next one.
 */
import type { ChatMessage } from '../../chat'
import { isToolBackedItem, type AgentItem, type ToolBackedItem } from '../../agents/items'
import { itemResultModelText } from '../result-text'
import { applyPlan, withItemResultText } from '../apply'
import type { Operation } from '../op-menu'
import type { CompressionPlan } from '../plan'
import { elidedPointer } from '../pointers'
import type { FrozenToolOp, FrozenTransform } from './types'

export interface TransformFlags {
  recoveryToolAvailable: boolean
  recallToolAvailable: boolean
}

/**
 * Drop the thinking a message carries.
 *
 * A signed thinking block is bound to the exact history before it. A checkpoint rewrites that
 * history, so every block produced before it is invalid afterwards — Anthropic would drop it
 * together with every LATER block (`prefix_mismatch_behavior: "drop_block"`), including the
 * ones produced after the checkpoint. Removing them here is what keeps those later blocks
 * valid: an edit at the front, followed by nothing but appends.
 */
export function stripReasoning<M extends ChatMessage>(message: M): M {
  const items = message.items
  if (!items?.some((item) => item.type === 'reasoning')) return message
  return { ...message, items: items.filter((item) => item.type !== 'reasoning') }
}

/**
 * Live-state snapshots (`supersedeKey`: a preview page, a terminal screen) that a newer
 * same-key result replaced. Only the newest snapshot of a key describes the world; the older
 * ones are pointers. Decided here, at a checkpoint, and nowhere else: collapsing an old
 * snapshot on the turn a new one arrives would rewrite an already-sent message.
 */
export function supersededSnapshots(messages: readonly ChatMessage[]): Map<string, string[]> {
  const latest = new Map<string, string>()
  for (const message of messages) {
    for (const item of message.items ?? []) {
      if (isToolBackedItem(item) && item.supersedeKey && item.toolCallId) {
        latest.set(item.supersedeKey, item.toolCallId)
      }
    }
  }
  const byMessage = new Map<string, string[]>()
  if (latest.size === 0) return byMessage
  for (const message of messages) {
    const stale = (message.items ?? []).flatMap((item) =>
      isToolBackedItem(item) &&
      item.supersedeKey &&
      latest.get(item.supersedeKey) !== item.toolCallId
        ? [item.toolCallId]
        : [],
    )
    if (stale.length > 0) byMessage.set(message.id, stale)
  }
  return byMessage
}

function collapseSnapshot(item: ToolBackedItem, recoveryToolAvailable: boolean): ToolBackedItem {
  const text = itemResultModelText(item)
  // The images go with the text: a stale screenshot is the heaviest thing a snapshot carries.
  const collapsed: ToolBackedItem = withItemResultText(
    item,
    elidedPointer(
      `Superseded ${item.supersedeKey} snapshot`,
      text.length,
      item.toolCallId,
      undefined,
      recoveryToolAvailable,
    ),
  )
  delete collapsed.attachments
  return collapsed
}

function applySuperseded<M extends ChatMessage>(
  message: M,
  ids: readonly string[] | undefined,
  recoveryToolAvailable: boolean,
): M {
  if (!ids?.length || !message.items) return message
  const stale = new Set(ids)
  const items = message.items.map((item): AgentItem =>
    isToolBackedItem(item) && stale.has(item.toolCallId)
      ? collapseSnapshot(item, recoveryToolAvailable)
      : item,
  )
  return { ...message, items }
}

/** A frozen op, as the operation `applyPlan` executes. A chosen op's cost no longer matters. */
function operationOf(op: FrozenTransform['op']): Operation | undefined {
  if (!op) return undefined
  const tool = (frozen: FrozenToolOp): Operation => ({
    kind: frozen.kind,
    cost: 0,
    retention: 0,
    ...(frozen.truncateChars !== undefined ? { truncateChars: frozen.truncateChars } : {}),
  })
  if (op.kind !== 'fold') return tool(op)
  return {
    kind: 'fold',
    cost: 0,
    retention: 0,
    ...(op.stackedOn ? { stackedOn: tool(op.stackedOn) } : {}),
  }
}

/** Apply a kept message's frozen transform: its superseded snapshots, then its op. */
export function applyFrozenTransform<M extends ChatMessage>(
  message: M,
  transform: FrozenTransform | undefined,
  flags: TransformFlags,
): M {
  if (!transform) return message
  const collapsed = applySuperseded(
    message,
    transform.supersededItemIds,
    flags.recoveryToolAvailable,
  )
  const op = operationOf(transform.op)
  if (!op) return collapsed
  const plan: CompressionPlan = {
    assignment: [{ index: 0, op }],
    estTokensBefore: 0,
    estTokensAfter: 0,
    budget: Number.POSITIVE_INFINITY,
    ...(transform.protectedItemIds?.length
      ? { protectedItemIds: new Set(transform.protectedItemIds) }
      : {}),
    ...(transform.readFates ? { readFates: new Map(Object.entries(transform.readFates)) } : {}),
  }
  return applyPlan([collapsed], plan, flags)[0]!
}

function frozenToolOp(op: Operation): FrozenToolOp | undefined {
  if (op.kind === 'verbatim' || op.kind === 'fold') return undefined
  return {
    kind: op.kind,
    ...(op.truncateChars !== undefined ? { truncateChars: op.truncateChars } : {}),
  }
}

/**
 * Freeze what a plan chose for ONE message, keeping only the facts about its own items — so
 * applying it later needs neither the plan nor any other message.
 */
export function freezeTransform(
  message: ChatMessage,
  op: Operation,
  plan: CompressionPlan,
  supersededItemIds: readonly string[] | undefined,
): FrozenTransform | undefined {
  const ownIds = new Set(
    (message.items ?? []).flatMap((item) => (isToolBackedItem(item) ? [item.toolCallId] : [])),
  )
  const stackedOn = op.kind === 'fold' && op.stackedOn ? frozenToolOp(op.stackedOn) : undefined
  const frozen: FrozenTransform['op'] =
    op.kind === 'fold' ? { kind: 'fold', ...(stackedOn ? { stackedOn } : {}) } : frozenToolOp(op)
  const protectedItemIds = [...(plan.protectedItemIds ?? [])].filter((id) => ownIds.has(id))
  const readFates = Object.fromEntries([...(plan.readFates ?? [])].filter(([id]) => ownIds.has(id)))
  const transform: FrozenTransform = {
    ...(frozen ? { op: frozen } : {}),
    ...(frozen && protectedItemIds.length > 0 ? { protectedItemIds } : {}),
    ...(frozen && Object.keys(readFates).length > 0 ? { readFates } : {}),
    ...(supersededItemIds?.length ? { supersededItemIds: [...supersededItemIds] } : {}),
  }
  return transform.op || transform.supersededItemIds ? transform : undefined
}
