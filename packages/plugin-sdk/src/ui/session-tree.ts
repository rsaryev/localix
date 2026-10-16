/** Minimal shape needed to walk parent links. */
export interface SessionTreeNode {
  id: string
  parentSessionId?: string | null
}

/**
 * The ancestor chain from the root session down to `active`, root-first.
 * Walks `parentSessionId` links, resolving each via `all`. Guards against cycles
 * (a self/loop reference stops the walk) and dangling parents (an unknown
 * parentSessionId ends the chain). Returns [] when there is no active session.
 * Generic so callers keep their full session type.
 */
export function buildSessionChain<T extends SessionTreeNode>(
  active: T | null | undefined,
  all: readonly T[],
): T[] {
  if (!active) return []
  const byId = new Map(all.map((s) => [s.id, s]))
  const chain: T[] = []
  const seen = new Set<string>()
  let cursor: T | null | undefined = active
  while (cursor && !seen.has(cursor.id)) {
    chain.unshift(cursor)
    seen.add(cursor.id)
    cursor = cursor.parentSessionId ? (byId.get(cursor.parentSessionId) ?? null) : null
  }
  return chain
}
