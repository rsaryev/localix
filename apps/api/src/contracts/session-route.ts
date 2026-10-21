import { DEFAULT_AGENT_HANDLE } from '../db/participant'
import { builtinAgentId } from '@localixai/agent/agents'
import type { SessionAgentRoute } from '../features/chat/contracts/read-model'

/**
 * WHICH AGENT'S MODEL A CALLER MEANS.
 *
 * A session no longer has "a model": it has a party, and each participant runs on its own
 * {connection, model, effort}. Most callers still mean one particular participant's, and this
 * is where they say which — deliberately as a function call rather than a field on the record,
 * so that a site which should have asked about a SPECIFIC agent cannot silently read the
 * first one and look correct.
 *
 * Two answers exist and they are not interchangeable:
 *
 *   - {@link sessionRoute} — the session's own route. Correct wherever the session has exactly
 *     one participant, which is every private chat and every worker, job and member session.
 *   - {@link agentRoute} — a named participant's route. Correct in a group, where the answer
 *     depends on who is speaking, and correct anywhere the caller already knows the handle.
 */

/**
 * A record shaped enough to route: anything carrying the party.
 *
 * Structural on purpose. The server's `SessionRecord`, the wire `SessionSummary` and the
 * browser's own session object are three shapes of the same conversation, and all three ask
 * this question — so the answer lives in one leaf both sides import rather than in a copy per
 * side, which is exactly how `wake-provenance` came to exist.
 */
export interface RoutableSession {
  agents: readonly SessionAgentRoute[]
}

/**
 * The route a conversation falls back to when nothing at all is known: the default agent, on
 * no connection and no model. Both a legal starting state (the user has not chosen yet) and
 * the answer to an unreadable party.
 */
export const blankRoute = (): SessionAgentRoute => ({
  agentId: builtinAgentId(DEFAULT_AGENT_HANDLE),
  handle: DEFAULT_AGENT_HANDLE,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'medium',
})

/**
 * The route of the session's FIRST participant.
 *
 * In a private chat that is the only counterpart, so this is simply "this session's model".
 * In a group it is the first member to have joined, which is a defensible default for the
 * things a room needs a model for at all (its title generation, the seed for a new member)
 * but is NOT the right answer for running a member's turn — that is {@link agentRoute}.
 *
 * Never throws on an absent party, though the repository's read contract says there is always
 * one. Two callers legitimately have less than a whole record: a narrow test harness that
 * builds a session out of the two fields its case is about, and a session whose party write
 * did not commit. Neither is a reason to fail a turn, and the answer for both is the same
 * blank route a brand-new conversation starts on.
 */
export function sessionRoute(session: RoutableSession): SessionAgentRoute {
  return session.agents?.[0] ?? blankRoute()
}

/**
 * The route of one named participant. A removed participant has no route: callers must
 * handle that absence rather than borrow another member's model and credentials.
 */
export function agentRoute(
  session: RoutableSession,
  agentId: string,
): SessionAgentRoute | undefined {
  return session.agents.find((route) => route.agentId === agentId)
}

/**
 * Whether this conversation has more than one agent in it — the one question every
 * multi-participant branch asks, answered once.
 *
 * Tolerant of absent participants for the same reason {@link sessionRoute} is: a narrow test
 * harness builds a session out of the two fields its case is about, and a multi-participant check
 * is never the thing that should fail such a run.
 */
export function isMultiParticipant(session: { agents?: readonly unknown[] | null }): boolean {
  return (session.agents?.length ?? 0) > 1
}

/**
 * The route a copy of a conversation (a fork, a thread) carries: the seat as stored. Every seat
 * holds an explicit route, so a copy runs on exactly what its source runs on.
 */
export function chosenRoute<T extends SessionAgentRoute>(route: T): T {
  return { ...route }
}

/**
 * A copy of the session with ONE participant re-routed.
 *
 * The slash commands and the provider-rebind path both change what a conversation runs on and
 * both hold a `SessionRecord` they are about to persist. Doing that as a party map at each of
 * them would repeat the "leave everyone else alone" rule; getting it wrong in a room means
 * silently moving other members onto a model nobody chose for them.
 */
export function withRoute<T extends RoutableSession>(
  session: T,
  values: Partial<Pick<SessionAgentRoute, 'providerConnectionId' | 'modelId' | 'reasoningEffort'>>,
  agentId: string = sessionRoute(session).agentId,
): T {
  return {
    ...session,
    agents: session.agents.map((route) =>
      route.agentId === agentId ? { ...route, ...values } : route,
    ),
  }
}
