import { DEFAULT_AGENT_NAME } from '../db/author'
import { builtinAgentId } from '@localixai/agent/agents'
import type { SessionAgentRoute } from '../features/chat/contracts/read-model'

/**
 * WHICH MODEL A SESSION RUNS ON: the route of its one agent, stored on the session itself.
 */

/**
 * A record shaped enough to route: anything carrying the session's agent.
 *
 * Structural on purpose. The server's `SessionRecord`, the wire `SessionSummary` and the
 * browser's own session object are three shapes of the same conversation, and all three ask
 * this question, so the answer lives in one leaf both sides import.
 */
export interface RoutableSession {
  agent: SessionAgentRoute | null
}

/**
 * The route a conversation falls back to when nothing at all is known: the default agent, on
 * no connection and no model. Both a legal starting state (the user has not chosen yet) and
 * the answer to an unreadable agent record.
 */
export const blankRoute = (): SessionAgentRoute => ({
  agentId: builtinAgentId(DEFAULT_AGENT_NAME),
  name: DEFAULT_AGENT_NAME,
  providerConnectionId: null,
  modelId: '',
  reasoningEffort: 'medium',
})

/**
 * The session's route. Never throws on an absent agent: a narrow test harness builds a session
 * out of the fields its case is about, and a session that runs no model has none. The answer
 * for both is the blank route a brand-new conversation starts on.
 */
export function sessionRoute(session: RoutableSession): SessionAgentRoute {
  return session.agent ?? blankRoute()
}

/** The session's own agent route, or none when it has no agent (a log that runs no model). */
export function agentRoute(session: RoutableSession): SessionAgentRoute | undefined {
  return session.agent ?? undefined
}

/**
 * The route a copy of a conversation (a fork, a thread) carries: the route as stored, so a copy
 * runs on exactly what its source runs on.
 */
export function chosenRoute<T extends SessionAgentRoute>(route: T): T {
  return { ...route }
}

/**
 * A copy of the session with its agent re-routed. The slash commands and the provider-rebind
 * path both change what a conversation runs on and hold a `SessionRecord` they are about to
 * persist. The agent itself never changes.
 */
export function withRoute<T extends RoutableSession>(
  session: T,
  values: Partial<Pick<SessionAgentRoute, 'providerConnectionId' | 'modelId' | 'reasoningEffort'>>,
): T {
  return { ...session, agent: { ...sessionRoute(session), ...values } }
}
