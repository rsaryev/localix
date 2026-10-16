/**
 * THIS WINDOW'S COPY OF WHAT IS WAITING ON THE PERSON — the one store every attention channel reads.
 *
 * The roster used to be assembled in the window from stream frames (`hitl.requested`,
 * `user.mentioned`) into per-kind inboxes. A frame is not state: a reload, a second window or a
 * request asked while the window was closed left the inboxes empty although the run was still
 * blocked. The server now keeps the roster, so this store only MIRRORS it, by two paths:
 *
 *   - `GET /rpc/attention` on start and after every reconnect (what happened while not listening)
 *   - the user-wide `attention.updated` frame, a last-wins snapshot of the whole roster
 *
 * Both land through `applyAttentionRoster`. A fetch that started before a frame arrived answers
 * with an OLDER roster than the frame did, so a fetch only applies when no frame landed while it
 * was in flight — otherwise a slow GET would resurrect an item the person had just answered.
 *
 * Snooze is the one piece of client-only state: Escape on the dialog means "not now, in this
 * window", which is a fact about this window and not about the item. It is keyed by item key, so
 * a NEW request in the same chat still raises the dialog, and pruned as items leave the roster.
 */
import { create } from 'zustand'
import type { AttentionItem } from '@localixai/api/client'

import { backendClient } from '@/shared/api/client'

interface AttentionState {
  items: readonly AttentionItem[]
  /** Item keys the person put off in this window; they stay counted, they stop interrupting. */
  snoozed: ReadonlySet<string>
}

const EMPTY_ITEMS: readonly AttentionItem[] = []

export const useAttentionStore = create<AttentionState>(() => ({
  items: EMPTY_ITEMS,
  snoozed: new Set(),
}))

/** Bumped by every applied roster, so a fetch can tell that a frame overtook it. */
let rosterGeneration = 0

/** Replace the roster with the server's snapshot (the frame's, or a fetch's). */
export function applyAttentionRoster(items: readonly AttentionItem[]): void {
  rosterGeneration += 1
  useAttentionStore.setState((state) => {
    const live = new Set(items.map((item) => item.key))
    const snoozed = [...state.snoozed].filter((key) => live.has(key))
    return {
      items: items.length === 0 ? EMPTY_ITEMS : items,
      snoozed: snoozed.length === state.snoozed.size ? state.snoozed : new Set(snoozed),
    }
  })
}

/** "Not now" for one item in this window: it leaves the dialog, keeps its badge and dock count. */
export function snoozeAttention(key: string): void {
  useAttentionStore.setState((state) =>
    state.snoozed.has(key) ? {} : { snoozed: new Set([...state.snoozed, key]) },
  )
}

/**
 * Read the roster from the server. Applied only if no frame landed while the request was out; a
 * failed read keeps what the window has — the next frame or reconnect delivers the roster anyway.
 */
export async function loadAttention(
  fetchRoster: () => Promise<AttentionItem[]> = () => backendClient.listAttention(),
): Promise<boolean> {
  const startedAt = rosterGeneration
  try {
    const items = await fetchRoster()
    if (rosterGeneration === startedAt) applyAttentionRoster(items)
    return true
  } catch {
    /* keep the current roster */
    return false
  }
}

/** Explicit reset for isolated tests. */
export function resetAttentionForTests(): void {
  rosterGeneration = 0
  useAttentionStore.setState({ items: EMPTY_ITEMS, snoozed: new Set() })
}
