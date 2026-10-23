import { useMemo } from 'react'
import { create } from 'zustand'

/**
 * Standardized review-comment model — surface-agnostic so the SAME accumulate →
 * manage → submit flow backs the file editor, prose text and the website element
 * picker. Each surface supplies an {@link CommentAnchor} describing what
 * a comment points at; the store, the management UI (`shared/ui/comments`), and the
 * inline composer are all generic.
 */
export interface CommentAnchor {
  /** Surface kind: 'file' | 'element' | … (open for extension). */
  kind: string
  /** Stable target id within the surface (e.g. absolute file path, element id). */
  targetId: string
  /** Short human label for the target (e.g. "Line 5", "Lines 2–4", "Submit button"). */
  label: string
  /** Grouping key + display (e.g. a file's path + basename). Defaults to the target. */
  groupId?: string
  groupLabel?: string
  /** Optional context/snippet preview shown under the label. */
  context?: string
  /** Structured locator the surface understands (line range, rect, …) — used to navigate. */
  locator?: Record<string, unknown>
}

export interface Comment {
  id: string
  /** Batch scope — comments are grouped + submitted per scope (e.g. a chat session id). */
  scope: string
  anchor: CommentAnchor
  body: string
}

interface CommentsState {
  comments: Comment[]
  /** Add a comment to a scope; returns its id. */
  add: (scope: string, anchor: CommentAnchor, body: string) => string
  setBody: (id: string, body: string) => void
  remove: (id: string) => void
  clearScope: (scope: string) => void
}

const genId = () => globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random()}`

/** Process-wide accumulation store. Filter by scope with {@link selectScopeComments}. */
export const useComments = create<CommentsState>((set) => ({
  comments: [],
  add: (scope, anchor, body) => {
    const id = genId()
    set((s) => ({ comments: [...s.comments, { id, scope, anchor, body }] }))
    return id
  },
  setBody: (id, body) =>
    set((s) => ({ comments: s.comments.map((c) => (c.id === id ? { ...c, body } : c)) })),
  remove: (id) => set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
  clearScope: (scope) => set((s) => ({ comments: s.comments.filter((c) => c.scope !== scope) })),
}))

/**
 * Comments in one scope (e.g. one session). Selects the STABLE `comments`
 * array and filters in a memo — selecting `s.comments.filter(...)` directly returns
 * a fresh array each render and trips React's "getSnapshot should be cached" loop.
 */
export function useScopeComments(scope: string | null | undefined): Comment[] {
  const all = useComments((s) => s.comments)
  return useMemo(() => (scope ? all.filter((c) => c.scope === scope) : []), [all, scope])
}

/** Group a flat comment list by anchor group (file/element/…), preserving first-seen order. */
export function groupComments(
  comments: Comment[],
): { groupId: string; groupLabel: string; items: Comment[] }[] {
  const groups = new Map<string, { groupId: string; groupLabel: string; items: Comment[] }>()
  for (const c of comments) {
    const groupId = c.anchor.groupId ?? c.anchor.targetId
    const groupLabel = c.anchor.groupLabel ?? c.anchor.label
    let g = groups.get(groupId)
    if (!g) {
      g = { groupId, groupLabel, items: [] }
      groups.set(groupId, g)
    }
    g.items.push(c)
  }
  return [...groups.values()]
}
