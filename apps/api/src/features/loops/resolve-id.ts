import type { SessionLoop } from './contracts'

/**
 * Shortest id prefix accepted by {@link resolveLoopId}. Below this the prefix is
 * treated as too ambiguous to resolve (only a full exact id matches). Human-facing
 * surfaces (`/loop list`, the composer strip) show an 8-char short id, so 6 keeps
 * a comfortable margin while refusing 1–5 char stubs.
 */
export const MIN_LOOP_ID_PREFIX = 6

export type LoopIdResolution =
  | { kind: 'match'; loop: SessionLoop }
  | { kind: 'ambiguous'; candidates: SessionLoop[] }
  | { kind: 'none' }

/**
 * Resolve a user-supplied loop id against a set of ALREADY-OWNED loops (i.e. the
 * caller has scoped `ownedLoops` to this user + session — this function does no
 * ownership gating of its own). An exact id wins outright; otherwise a
 * case-insensitive prefix of at least {@link MIN_LOOP_ID_PREFIX} chars resolves
 * when it is UNIQUE among the owned loops. A prefix matching more than one loop
 * is reported as `ambiguous` (with the candidates) so the caller can ask for more
 * characters rather than silently picking one.
 */
export function resolveLoopId(rawId: string, ownedLoops: readonly SessionLoop[]): LoopIdResolution {
  const id = rawId.trim()
  if (!id) return { kind: 'none' }

  // Exact match wins even below the prefix floor (a full id is unambiguous).
  const exact = ownedLoops.find((l) => l.id === id)
  if (exact) return { kind: 'match', loop: exact }

  if (id.length < MIN_LOOP_ID_PREFIX) return { kind: 'none' }

  const lower = id.toLowerCase()
  const prefixed = ownedLoops.filter((l) => l.id.toLowerCase().startsWith(lower))
  if (prefixed.length === 1) return { kind: 'match', loop: prefixed[0]! }
  if (prefixed.length > 1) return { kind: 'ambiguous', candidates: prefixed }
  return { kind: 'none' }
}
