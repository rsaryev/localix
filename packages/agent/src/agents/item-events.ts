import type { AgentItem, StopReason, TurnState, TurnUsage } from './item-model'

// ---- Event taxonomy ----------------------------------------------------------

/**
 * Item lifecycle events. `item.delta` streams into a named string field
 * (`text` for narrative items, `output` for command) without re-sending the
 * whole item. `item.updated` patches status/metadata. `item.completed` carries
 * the authoritative final item (it may differ from accumulated deltas).
 */
export type AgentItemEvent =
  | { kind: 'item.started'; item: AgentItem }
  | { kind: 'item.delta'; itemId: string; field?: 'text' | 'output'; delta: string }
  | { kind: 'item.updated'; itemId: string; patch: Partial<AgentItem> }
  | { kind: 'item.completed'; item: AgentItem }

export type AgentTurnEvent =
  | { kind: 'turn.started'; turnId: string }
  | { kind: 'turn.updated'; turnId: string; usage?: TurnUsage; aggregatedDiff?: string }
  | { kind: 'turn.completed'; turnId: string; stopReason: StopReason; usage?: TurnUsage }

// ---- Reducer -----------------------------------------------------------------

const DELTA_TAIL_CHARS = 16_000

function appendDelta(prev: string | undefined, delta: string): string {
  const next = (prev ?? '') + delta
  return next.length > DELTA_TAIL_CHARS ? '…' + next.slice(-DELTA_TAIL_CHARS) : next
}

/**
 * Fold one item event into the items list (upsert by id, order preserved).
 * Pure — returns a new array only when something changed. Unknown item ids on
 * delta/updated are ignored (the started event may not have arrived yet on a
 * lossy transport; callers can buffer if they need strict ordering).
 */
export function applyItemEvent(items: readonly AgentItem[], event: AgentItemEvent): AgentItem[] {
  switch (event.kind) {
    case 'item.started':
    case 'item.completed': {
      const idx = items.findIndex((i) => i.id === event.item.id)
      if (idx === -1) return [...items, event.item]
      const next = items.slice()
      next[idx] = event.item
      return next
    }
    case 'item.delta': {
      const idx = items.findIndex((i) => i.id === event.itemId)
      if (idx === -1) return items as AgentItem[]
      const item = items[idx]
      const field = event.field ?? 'text'
      let patched: AgentItem | undefined
      if (field === 'text' && (item.type === 'text' || item.type === 'reasoning')) {
        patched = { ...item, text: appendDelta(item.text, event.delta) }
      } else if (field === 'output' && item.type === 'command') {
        patched = { ...item, output: appendDelta(item.output, event.delta) }
      }
      if (!patched) return items as AgentItem[]
      const next = items.slice()
      next[idx] = patched
      return next
    }
    case 'item.updated': {
      const idx = items.findIndex((i) => i.id === event.itemId)
      if (idx === -1) return items as AgentItem[]
      const next = items.slice()
      // Patch is same-type by construction (callers patch their own item); the
      // cast is safe because we never change `type` via a patch.
      next[idx] = { ...items[idx], ...event.patch } as AgentItem
      return next
    }
  }
}

/** Fold a turn event into turn state (excluding items, which use applyItemEvent). */
export function applyTurnEvent(turn: TurnState, event: AgentTurnEvent): TurnState {
  switch (event.kind) {
    case 'turn.started':
      return { ...turn, id: event.turnId, status: 'running' }
    case 'turn.updated':
      return {
        ...turn,
        usage: event.usage ?? turn.usage,
        aggregatedDiff: event.aggregatedDiff ?? turn.aggregatedDiff,
      }
    case 'turn.completed':
      return {
        ...turn,
        status:
          event.stopReason === 'error'
            ? 'failed'
            : event.stopReason === 'user_stopped'
              ? 'aborted'
              : 'completed',
        stopReason: event.stopReason,
        usage: event.usage ?? turn.usage,
      }
  }
}

/** A fresh, empty turn. */
export function emptyTurn(id: string): TurnState {
  return { id, status: 'running', items: [] }
}
