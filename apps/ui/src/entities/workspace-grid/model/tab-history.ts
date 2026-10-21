import type { WorkItem } from '@/shared/lib/workItem'
import { isEphemeralItem } from './capabilities'
import { isVisibleInScope, type ScopeId } from './scope'

/** How many user-closed tabs to remember for reopen-closed (⌘⇧T). */
export const MAX_CLOSED = 12

/** How many recent tab activations each group remembers (drives history-based
 *  activate-on-close). Bounded so a long-lived group's history can't grow forever. */
export const MAX_TAB_HISTORY = 16

/** Push `tabId` to the FRONT of a group's activation history (most-recent-first),
 *  deduping any earlier occurrence and capping the length. */
export function recordTabHistory(history: string[] | undefined, tabId: string): string[] {
  const next = [tabId, ...(history ?? []).filter((t) => t !== tabId)]
  return next.length > MAX_TAB_HISTORY ? next.slice(0, MAX_TAB_HISTORY) : next
}

/** The most-recently-activated SURVIVING tab from `history` that is also VISIBLE in
 *  `activeScope` (when given) — the "return to the previously-focused
 *  tab" pick. Null when history holds no eligible survivor (caller falls back to the
 *  positional neighbour). */
export function pickFromHistory(
  history: string[] | undefined,
  survivors: Set<string>,
  items: Record<string, WorkItem>,
  activeScope?: ScopeId,
): string | null {
  if (!history) return null
  for (const id of history) {
    if (!survivors.has(id)) continue
    if (activeScope && !isVisibleInScope(items[id]?.scope, activeScope)) continue
    return id
  }
  return null
}

/** A tab the user explicitly closed, remembered so it can be reopened where it
 *  was. Transient (not persisted) — cleared on reload. */
export interface ClosedTab {
  item: WorkItem
  /** The group it was closed from (reopened there if it still exists). */
  group: string
}

/** Push closed tabs onto the reopen stack (newest last), keeping only the items
 *  worth reopening (skip ephemeral previews/live streams — they re-derive) and
 *  capping the history. */
export function pushClosed(
  closed: ClosedTab[] | undefined,
  group: string,
  items: Record<string, WorkItem>,
  ids: string[],
): ClosedTab[] {
  const base = closed ?? []
  const reopenable = ids
    .map((id) => items[id])
    .filter((it): it is WorkItem => !!it && !isEphemeralItem(it))
  if (reopenable.length === 0) return base
  const next = [...base, ...reopenable.map((item) => ({ item, group }))]
  return next.length > MAX_CLOSED ? next.slice(next.length - MAX_CLOSED) : next
}

/** Pick the survivor that becomes active after closing the focused tab. Prefers a
 *  tab VISIBLE in `activeScope` (nearest to the right, else the last visible) so
 *  closing the active session's chat never promotes a hidden background-session
 *  tab — which, with the focus→URL sync gone, would otherwise just leave an
 *  invisible tab "active". Falls back to positional (right→left→first) when the
 *  scope is unknown or nothing visible survives. `idx` is the closed tab's
 *  original index; `tabs` is post-removal. */
export function pickNextActiveTab(
  tabs: string[],
  idx: number,
  items: Record<string, WorkItem>,
  activeScope?: ScopeId,
): string | null {
  if (activeScope) {
    const visible = tabs.flatMap((t, i) =>
      isVisibleInScope(items[t]?.scope, activeScope) ? [{ t, i }] : [],
    )
    if (visible.length > 0)
      return (visible.find(({ i }) => i >= idx) ?? visible[visible.length - 1]).t
  }
  return tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null
}
