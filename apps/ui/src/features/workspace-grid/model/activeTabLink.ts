/**
 * Open-tab auto-link — derive the composer's ambient "this is your working set"
 * links from the editor grid. Active on-screen tabs rank first, followed by the
 * recently used and then the remaining open tabs in the current scope. Every
 * candidate maps through the SAME `workItemToMessageBinding` mapping tab-strip
 * dragging uses — no parallel tab→ref vocabulary.
 *
 * Pure selectors here; the thin zustand hook lives in `useActiveTabRef.ts`.
 */
import type { WorkItem } from '@/shared/lib/workItem'
import type { MessageContextBindingDraft } from '@localixai/plugin-sdk/ui'
import { workItemToMessageBindings } from './tabMessageBinding'
import { type FocusedFileState, groupViewModel, scopedViewRoot } from './groupView'
import { findLeaf, leaves } from './tree'

/**
 * How many tabs auto-link at once.
 *
 * One slot was the whole reason a tab you had just opened could fail to appear: the selector returned
 * the FIRST linkable candidate, so whichever group happened to be focused won and everything else was
 * invisible — the reported "drilling into a pod does not link". Five covers the common file +
 * database + chart working set without flooding the composer. On-screen tabs rank first, but open
 * tabs in the same scope remain eligible: the chips are the explicit preview and dismissal surface
 * for this bounded ambient set. Ambient bindings are also the first refs the 20-per-message wire and
 * context budgets shed, so they cannot displace a deliberate link.
 */
export const AUTO_LINK_LIMIT = 5

/**
 * How a candidate tab is RANKED. Ambient context is a guess, so the ranking has to be explainable in
 * one sentence: what you can see beats what you remember, and within each, where the caret is beats
 * where it was.
 *
 * The weights are ordinal, not tuned — they encode a strict precedence, and the tests pin the
 * ORDERING they produce rather than the numbers:
 *
 *   on screen + focused group  →  160    (the tab you are looking at)
 *   on screen, another group   →  120    (the panel beside it — visible, so it is context)
 *   open in the focused group  →   40+   (recently used before untouched strip tabs)
 *   open in another group      →    0+   (recently used before untouched strip tabs)
 *
 * ON_SCREEN outranks FOCUSED_GROUP deliberately, and that is the load-bearing choice: a visible pod
 * list in the next pane is better evidence of what you are working on than the third tab back in the
 * pane you happen to have clicked. Open tabs remain a lower-strength relevance signal. The bounded
 * lower-strength set stays visible as dismissible chips rather than being injected silently.
 *
 * RECENCY is capped below both so it only ever breaks ties inside a bucket. Unbounded recency here
 * would let a stale tab you cycled through outrank the panel in front of you.
 */
const ON_SCREEN = 100
const FOCUSED_GROUP = 40
const RECENCY_MAX = 20

/** One tab the grid offers, with the signals its rank is derived from. */
export interface TabCandidate {
  tabId: string
  /** Rendered right now (its group's active tab) rather than mounted-but-hidden. */
  onScreen: boolean
  /** Belongs to the group holding grid focus. */
  focusedGroup: boolean
  /** Position in its group's relevance order — 0 is on screen, then MRU, then strip order. */
  warmRank: number
}

/** The rank of one candidate. Exported because a score nobody can inspect is not explainable. */
export function candidateScore(c: TabCandidate): number {
  return (
    (c.onScreen ? ON_SCREEN : 0) +
    (c.focusedGroup ? FOCUSED_GROUP : 0) +
    RECENCY_MAX / (c.warmRank + 1)
  )
}

/** A linkable active tab, ready for the composer's auto-link channel. */
export interface ActiveTabLink {
  /** Grid tab id — the per-tab dismissal key. */
  tabId: string
  /** The complete opaque binding. URI + provider-owned attributes must survive intact. */
  binding: MessageContextBindingDraft
  /** Compatibility/presentation projection; consumers must resolve from `binding`. */
  token: string
  /** Compatibility/presentation projection; consumers must resolve from `binding`. */
  label?: string
}

/**
 * Canonical bindings for one tab, or an empty list when the tab is not linkable.
 * Files deliberately mint a CONTENT `@file:` ref for ambient context — unlike a
 * manual tab drop, whose default token is the link-only `@path` mention.
 */
export function tabMessageBindings(
  item: WorkItem | undefined,
  opts: { content?: boolean } = {},
): MessageContextBindingDraft[] {
  return workItemToMessageBindings(item).flatMap((binding) => {
    const path = binding.target.attributes?.path
    const wantsContent = opts.content !== false
    const token =
      binding.target.kind === 'file' && typeof path === 'string'
        ? wantsContent
          ? `@file:${path}`
          : `@${path}`
        : binding.target.token
    if (!token) return []
    return [
      {
        ...binding,
        // Provenance is minted by the host at the point this static/live binding
        // becomes ambient context; plugin drafts cannot spoof another source.
        source: 'active-tab',
        target: { ...binding.target, token },
      },
    ]
  })
}

/** Single-token compatibility façade used by tab-strip callers and older tests. */
export function tabLinkToken(
  item: WorkItem | undefined,
  opts: { content?: boolean } = {},
): { token: string; label?: string } | null {
  const binding = tabMessageBindings(item, opts)[0]
  return binding ? { token: binding.target.token, label: binding.target.label } : null
}

/**
 * The grid's current auto-link candidates: all open tabs in the active scope,
 * ranked by visibility, focus and recency. The single-link compatibility façade
 * still returns the highest-ranked linkable candidate.
 */
export function tabCandidates(state: FocusedFileState): TabCandidate[] {
  // The recency signal is the grid's own per-(scope, group) tab MRU — `scopeActiveTab`,
  // "most-recent FIRST", maintained by `recordScopeActive` and pruned by `dropTabFromScopeActive`.
  // Nothing new is tracked: this reads the order the warm-body lifecycle already keeps, which is also
  // why it needs no timestamps (a stored ORDER replays identically, a wall-clock read would not).
  // Tabs outside that bounded MRU follow in stable strip order.
  //
  // The focused group is consulted even when the scoped view collapsed it out, so clicking into a
  // group whose tabs all belong to another session does not silently drop its history.
  const groupIds = [
    state.activeGroup,
    ...leaves(scopedViewRoot(state)).flatMap((l) => (l.id !== state.activeGroup ? [l.id] : [])),
  ]
  const out: TabCandidate[] = []
  const seen = new Set<string>()
  for (const groupId of groupIds) {
    const leaf = findLeaf(state.root, groupId)
    if (!leaf) continue
    const view = groupViewModel(
      leaf,
      state.items,
      state.activeScope,
      state.warmScopes,
      state.scopeActiveTab,
    )
    const focusedGroup = groupId === state.activeGroup
    const ids = [
      ...(view.visibleActive ? [view.visibleActive] : []),
      ...view.warmRecentIds,
      ...view.visibleTabs,
    ].filter((id, index, all) => all.indexOf(id) === index)
    ids.forEach((tabId, index) => {
      // `seen` CAN trigger: a tab re-homed to another group still sits in this group's stale MRU
      // entry, and the group view filters by scope visibility, not by ownership history.
      if (seen.has(tabId) || !state.items[tabId]) return
      seen.add(tabId)
      out.push({
        tabId,
        onScreen: tabId === view.visibleActive,
        focusedGroup,
        warmRank: index,
      })
    })
  }
  return out
}

/**
 * The grid's ranked auto-link candidates — highest score first, capped at `limit`.
 *
 * Ranking happens over ALL candidates before the cap, which is the point: a group-by-group walk let
 * one group's warm history fill every slot while a visible panel next to it never got considered.
 */
export function activeTabLinks(state: FocusedFileState, limit = AUTO_LINK_LIMIT): ActiveTabLink[] {
  const ranked = tabCandidates(state).sort(
    // Array#sort is stable, so equal scores keep grid order (the tree walk) — a regenerate produces
    // the same context set, which the capture-once/replay guarantee depends on.
    (a, b) => candidateScore(b) - candidateScore(a),
  )
  const out: ActiveTabLink[] = []
  for (const candidate of ranked) {
    if (out.length >= limit) break
    for (const binding of tabMessageBindings(state.items[candidate.tabId])) {
      if (out.length >= limit) break
      out.push({
        tabId: candidate.tabId,
        binding,
        token: binding.target.token,
        label: binding.target.label,
      })
    }
  }
  return out
}

/**
 * The single primary candidate — the façade every existing consumer still uses.
 *
 * Kept so widening to N is opt-in: a caller that wants one link is not forced to learn an array,
 * and the previous behaviour (first linkable, content-bearing) is byte-identical.
 */
export function activeTabLink(state: FocusedFileState): ActiveTabLink | null {
  return activeTabLinks(state, 1)[0] ?? null
}
