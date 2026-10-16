/**
 * THE ONE PLACE A "WAITING ON YOU" ITEM IS RAISED AND SETTLED.
 *
 * Every consumer of attention used to read its own source: the journal had a producer per kind,
 * the sidebar derived marks from whichever frames it happened to receive, and a reload restored
 * only what the loaded session carried — so a question asked in a session the person was not
 * looking at survived in the Event Center and vanished from the sidebar. Here each source
 * (`sources.ts`) raises and settles items, and everything else follows from the registry:
 *
 *   - `onChange` → the user's whole open set, published as one last-wins `attention.updated`;
 *   - `list`     → `GET /rpc/attention`, what a reload restores;
 *   - `observe`  → the journal mirror (`notifications/producers/attention.ts`), one row per item.
 *
 * Settling ALWAYS reaches the observers, even when the registry holds nothing under the target:
 * a mention raised before a restart is a journal row with no item behind it, and the person's
 * reply must still settle it. `restore` is the opposite — a boot rebuild of durable kinds loads
 * items whose rows already exist, so it reaches only the snapshot, never the journal.
 */
import {
  matchesTarget,
  type AttentionItem,
  type AttentionSettleReason,
  type AttentionTarget,
} from './contracts'

export interface AttentionObserver {
  raised(userId: string, item: AttentionItem): void
  settled(userId: string, target: AttentionTarget, reason: AttentionSettleReason): void
}

export type AttentionChangeListener = (userId: string, items: AttentionItem[]) => void

export function createAttentionRegistry(deps: { warn?: (message: string) => void } = {}) {
  const byUser = new Map<string, Map<string, AttentionItem>>()
  const listeners = new Set<AttentionChangeListener>()
  const observers = new Set<AttentionObserver>()

  const safely = (what: string, run: () => void) => {
    try {
      run()
    } catch (error) {
      deps.warn?.(
        `attention ${what} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** Oldest first: the item waiting longest is the one to answer first. */
  const list = (userId: string): AttentionItem[] =>
    [...(byUser.get(userId)?.values() ?? [])].sort((a, b) => a.at.localeCompare(b.at))

  const changed = (userId: string) => {
    const items = list(userId)
    for (const listener of listeners) safely('listener', () => listener(userId, items))
  }

  const itemsOf = (userId: string) => {
    let items = byUser.get(userId)
    if (!items) byUser.set(userId, (items = new Map()))
    return items
  }

  const remove = (userId: string, target: AttentionTarget): boolean => {
    const items = byUser.get(userId)
    if (!items) return false
    let removed = false
    // Deleting the entry being visited is safe for a Map iterator.
    for (const key of items.keys())
      if (matchesTarget(key, target)) removed = items.delete(key) || removed
    return removed
  }

  return {
    /** An item started waiting. Raising its key again replaces it (a re-published request). */
    raise(userId: string, item: AttentionItem): void {
      itemsOf(userId).set(item.key, item)
      changed(userId)
      for (const observer of observers) safely('observer', () => observer.raised(userId, item))
    },

    /** Whatever matches stopped waiting, for `reason`. */
    settle(userId: string, target: AttentionTarget, reason: AttentionSettleReason): void {
      if (remove(userId, target)) changed(userId)
      for (const observer of observers)
        safely('observer', () => observer.settled(userId, target, reason))
    },

    /** Load durable items at boot — the snapshot learns them; the journal already has them. */
    restore(userId: string, items: readonly AttentionItem[]): void {
      if (!items.length) return
      const held = itemsOf(userId)
      for (const item of items) held.set(item.key, item)
      changed(userId)
    },

    list,

    /**
     * A deleted session's items go with it. The snapshot only: the session's records were
     * cascaded away, and a deletion is not an answer the journal should file.
     */
    forgetSession(sessionId: string): void {
      for (const [userId, items] of byUser) {
        let removed = false
        for (const [key, item] of items)
          if (item.sessionId === sessionId) removed = items.delete(key) || removed
        if (removed) changed(userId)
      }
    },

    onChange(listener: AttentionChangeListener): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    observe(observer: AttentionObserver): () => void {
      observers.add(observer)
      return () => void observers.delete(observer)
    },
  }
}

export type AttentionRegistry = ReturnType<typeof createAttentionRegistry>
