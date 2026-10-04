/**
 * One answer to "if this run raises a human-in-the-loop prompt, will a human ever
 * see it?" — the question every HITL-raising surface has to ask before it blocks.
 *
 * The input is `hitlTargetSessionId`, resolved once per run from AUTHORITATIVE parent
 * links (stages/admit.ts) rather than the denormalized `rootSessionId` hint, so a
 * stale or forged value cannot redirect a prompt. It is non-null only when the run's
 * root ancestor is a `chat` session owned by the same user.
 *
 * Note what that means for a SUB-AGENT: its own `sessionKind` is `subagent`, but a
 * prompt it raises is surfaced into the root chat (event-handlers-hitl.ts retitles it
 * "Sub-agent … needs input"), so it IS reachable. Keying off `sessionKind === 'chat'`
 * instead would wrongly deny a sub-agent a prompt the user would in fact have seen.
 *
 * The `job` clause is the historical carve-out: a parentless automation job resolves
 * its own session as the root, which is not a chat surface anybody watches.
 */
import { resolveSessionRoot, type SessionAncestryNode } from '../../session-ancestry'

export interface HitlReachability {
  sessionKind: string
  sessionId: string
  hitlTargetSessionId: string | null
}

/**
 * The session a prompt from this run can be RENDERED in, or `null` when none can.
 * Returning the id rather than a boolean lets a caller that needs to publish to it
 * narrow the type from one check, instead of re-testing for null next to the rule.
 */
export function reachableHitlTarget(input: HitlReachability): string | null {
  if (!input.hitlTargetSessionId) return null
  if (input.sessionKind === 'job' && input.hitlTargetSessionId === input.sessionId) return null
  return input.hitlTargetSessionId
}

/** Boolean form, for surfaces that only need to know whether a human can answer. */
export function isHitlReachable(input: HitlReachability): boolean {
  return reachableHitlTarget(input) !== null
}

/**
 * Both answers a run needs, derived once from AUTHORITATIVE parent links.
 *
 * `rootSessionId` is a denormalized hint and is deliberately not consulted, so a stale or
 * forged value cannot redirect a prompt. Invalid ancestry leaves ordinary work intact and
 * makes any later HITL request fail closed instead of surfacing to an unverified session.
 *
 * It lives beside the rule rather than in the run assembly that used to hold it because the
 * two are one decision: a target nobody watches is not a target, and a caller that derived
 * the id itself had to remember to ask the second question too.
 */
export function resolveRunHitlRouting<T extends SessionAncestryNode & { sessionKind: string }>(
  session: T,
  userId: string,
  /** The owner's sessions — needed only when this one has a parent to walk to. */
  ownerSessions: readonly T[],
): { targetSessionId: string | null; reachable: boolean } {
  const root = session.parentSessionId
    ? resolveSessionRoot(session, ownerSessions)
    : ({ ok: true, root: session, depth: 0 } as const)
  const targetSessionId =
    root.ok && root.root.userId === userId && root.root.sessionKind === 'chat' ? root.root.id : null
  return {
    targetSessionId,
    reachable: isHitlReachable({
      sessionKind: session.sessionKind,
      sessionId: session.id,
      hitlTargetSessionId: targetSessionId,
    }),
  }
}
