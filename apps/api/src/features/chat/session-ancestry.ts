/**
 * Pure, provider/runtime-agnostic session ancestry resolution.
 *
 * `rootSessionId` is intentionally absent from the input shape: it is a cache/hint,
 * not authority. The parent links are the authoritative lineage. Callers must pass
 * only sessions visible to the same owner; the explicit owner check below fails
 * closed if a mixed-owner collection is supplied accidentally.
 */
export interface SessionAncestryNode {
  id: string
  userId: string
  parentSessionId: string | null
}

export type SessionRootResolution<T extends SessionAncestryNode> =
  | { ok: true; root: T; depth: number }
  | {
      ok: false
      reason: 'cycle' | 'missing-ancestor' | 'owner-mismatch' | 'depth-exceeded'
      sessionId: string
    }

export const MAX_SESSION_ANCESTRY_DEPTH = 128

/**
 * Resolve the terminal parentless ancestor from an in-memory owner-scoped set.
 * The function performs no I/O and never consults denormalized root metadata.
 */
export function resolveSessionRoot<T extends SessionAncestryNode>(
  start: T,
  ownerSessions: readonly T[],
  maxDepth = MAX_SESSION_ANCESTRY_DEPTH,
): SessionRootResolution<T> {
  const byId = new Map(ownerSessions.map((session) => [session.id, session]))
  byId.set(start.id, start)

  const visited = new Set<string>()
  let current = start
  let depth = 0

  while (true) {
    if (current.userId !== start.userId) {
      return { ok: false, reason: 'owner-mismatch', sessionId: current.id }
    }
    if (visited.has(current.id)) {
      return { ok: false, reason: 'cycle', sessionId: current.id }
    }
    visited.add(current.id)

    const parentId = current.parentSessionId
    if (parentId === null) return { ok: true, root: current, depth }
    if (depth >= maxDepth) {
      return { ok: false, reason: 'depth-exceeded', sessionId: parentId }
    }

    const parent = byId.get(parentId)
    if (!parent) return { ok: false, reason: 'missing-ancestor', sessionId: parentId }
    current = parent
    depth += 1
  }
}

export function sessionRootResolutionError(
  sessionId: string,
  resolution: Extract<SessionRootResolution<SessionAncestryNode>, { ok: false }>,
): Error {
  return new Error(
    `Cannot resolve root ancestor for session ${sessionId}: ${resolution.reason} at ${resolution.sessionId}`,
  )
}
