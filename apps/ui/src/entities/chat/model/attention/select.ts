/**
 * THE READS EVERY ATTENTION CHANNEL SHARES — so the dialog, the sidebar and the dock cannot rank
 * or count the same roster differently.
 *
 * Each channel used to filter and sort its own inbox, and they drifted: the dock counted mentions
 * the sidebar never showed, and the mention dialog had to read the HITL inbox to know whether to
 * stay out of the way. Here the order is defined once (`compareAttention`: policy priority, then
 * newest first) and each channel asks one question of it:
 *
 *   attentionBySession   the sidebar row: what is waiting in THIS conversation, best first
 *   dialogAttentionItem  the modal: the one item worth interrupting for right now
 *   dockAttentionCount   the dock: how many conversations are waiting
 *
 * `attentionBySession` is memoized on the roster array, which the store replaces only when a
 * snapshot lands — so a hundred sidebar rows selecting their own entry share one grouping pass
 * and get referentially stable arrays (no re-render per unrelated store write).
 */
import type { AttentionItem } from '@localixai/api/client'

import { attentionPolicyOf } from './policy'

const at = (item: AttentionItem): number => {
  const ms = Date.parse(item.at)
  return Number.isFinite(ms) ? ms : 0
}

/** Policy priority first, then the newest item. Unknown kinds never reach this. */
export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  const byPriority = attentionPolicyOf(a)!.priority - attentionPolicyOf(b)!.priority
  return byPriority !== 0 ? byPriority : at(b) - at(a)
}

const grouped = new WeakMap<readonly AttentionItem[], ReadonlyMap<string, AttentionItem[]>>()

/** Every known item, grouped by the session the person must open, each group best-first. */
export function attentionBySession(
  items: readonly AttentionItem[],
): ReadonlyMap<string, readonly AttentionItem[]> {
  const cached = grouped.get(items)
  if (cached) return cached
  const bySession = new Map<string, AttentionItem[]>()
  for (const item of items) {
    if (!attentionPolicyOf(item)) continue
    const group = bySession.get(item.sessionId)
    if (group) group.push(item)
    else bySession.set(item.sessionId, [item])
  }
  for (const group of bySession.values()) group.sort(compareAttention)
  grouped.set(items, bySession)
  return bySession
}

/** The item a session's badge shows: its highest-priority, newest item. */
export function topAttentionItem(
  items: readonly AttentionItem[],
  sessionId: string,
): AttentionItem | null {
  return attentionBySession(items).get(sessionId)?.[0] ?? null
}

/**
 * The item the cross-session dialog shows, or null. Only a kind allowed to interrupt, never one in
 * the conversation on screen (that chat already shows it in place), never one snoozed here.
 */
export function dialogAttentionItem(
  items: readonly AttentionItem[],
  activeSessionId: string | null,
  snoozed: ReadonlySet<string>,
): AttentionItem | null {
  let best: AttentionItem | null = null
  for (const item of items) {
    const policy = attentionPolicyOf(item)
    if (!policy?.interrupts || item.sessionId === activeSessionId || snoozed.has(item.key)) continue
    if (!best || compareAttention(item, best) < 0) best = item
  }
  return best
}

/** Conversations with at least one item that counts toward the dock badge. */
export function dockAttentionCount(items: readonly AttentionItem[]): number {
  const sessions = new Set<string>()
  for (const item of items) if (attentionPolicyOf(item)?.countsOnDock) sessions.add(item.sessionId)
  return sessions.size
}
