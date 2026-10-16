/**
 * "THIS SESSION" PERMISSION GRANTS — whose they are, and where they are shown.
 *
 * A grant used to be keyed by the session its card surfaced in and nothing else. In a
 * conversation with several participants, "allow `git` for this session" answered on one
 * participant's card auto-approved `git` for EVERY participant — and for every sub-agent whose
 * cards surface in the same parent — none of whom the person had approved. A grant is an answer
 * to ONE requester, so it is stored under that requester:
 *
 *   surfaced-in session (the chip that shows it, the delete that reaps it)
 *     → requester (the asking session + agent)
 *       → program scopes granted
 *
 * The outer key stays the surfaced-in session so the composer's chip still lists — and revokes —
 * everything granted in the conversation the person is looking at. In-memory on purpose: a
 * restart or a different session asks again, so a grant never leaks across a process boundary.
 */
import { agentLaneKey } from '../../agent-core/execution-address'

export type SessionGrants = Map<string, Map<string, Set<string>>>

/** Bound per requester; the real program vocabulary of a session is tiny, so this never bites. */
const MAX_SCOPES_PER_REQUESTER = 64

export interface GrantRequester {
  /** The session whose run asked (a sub-agent's own session, not its parent). */
  sessionId: string
  agentId: string
}

const requesterKey = (requester: GrantRequester): string => agentLaneKey(requester)

/** The scopes this requester holds in the conversation where its cards surface. */
export function grantedScopes(
  grants: SessionGrants,
  surfacedIn: string,
  requester: GrantRequester,
): ReadonlySet<string> {
  return grants.get(surfacedIn)?.get(requesterKey(requester)) ?? new Set()
}

/** Record one grant; returns the conversation's full, sorted list for the chip. */
export function grantScope(
  grants: SessionGrants,
  surfacedIn: string,
  requester: GrantRequester,
  scope: string,
): string[] {
  let bySession = grants.get(surfacedIn)
  if (!bySession) {
    bySession = new Map()
    grants.set(surfacedIn, bySession)
  }
  const key = requesterKey(requester)
  let scopes = bySession.get(key)
  if (!scopes) {
    scopes = new Set()
    bySession.set(key, scopes)
  }
  if (scopes.size < MAX_SCOPES_PER_REQUESTER) scopes.add(scope)
  return listSessionGrants(grants, surfacedIn)
}

/** Everything granted in this conversation, as the chip shows it: distinct scopes, sorted. */
export function listSessionGrants(grants: SessionGrants, surfacedIn: string): string[] {
  const all = new Set<string>()
  for (const scopes of grants.get(surfacedIn)?.values() ?? []) for (const s of scopes) all.add(s)
  return [...all].sort()
}

/**
 * Revoke from the chip: one scope (from every requester that holds it) or, with none named,
 * everything granted in this conversation. Returns what remains.
 */
export function revokeSessionGrant(
  grants: SessionGrants,
  surfacedIn: string,
  scope?: string,
): string[] {
  const bySession = grants.get(surfacedIn)
  if (!bySession) return []
  if (scope === undefined) bySession.clear()
  else
    for (const [key, scopes] of bySession) {
      scopes.delete(scope)
      if (scopes.size === 0) bySession.delete(key)
    }
  if (bySession.size === 0) grants.delete(surfacedIn)
  return listSessionGrants(grants, surfacedIn)
}
