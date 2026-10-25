/**
 * The model an agent's own card names — the third link of the conversation's model chain
 * (see `chat/agent-route-resolution.ts`, which states the order: session, project, agent).
 *
 * It lives here rather than in the chat feature because the shape being read is the agent
 * REGISTRY's: a card is authored, often by hand in a file, and what counts as a usable model on
 * it is this feature's rule. Chat receives the answer through a port and never learns where the
 * registry keeps it.
 *
 * Two things this translation has to do, both because a card is authored rather than generated:
 *
 *   - A card names a PROVIDER and a model, while a run wants one identifier. A bare model name
 *     is prefixed with its provider, the same spelling used everywhere else; a name that already
 *     carries one is left alone.
 *   - The connection is deliberately left null. A card cannot name one — connections are the
 *     user's credentials, not the agent's — and the run resolves a live connection for the model
 *     anyway, rebinding one that has since been replaced.
 */
import { agentModelRoute, type AgentRoute } from '../agent-core/agent-model-route'
import type { AgentSummary } from './contracts'

/**
 * The port the chat service is handed: ask the registry, translate, answer.
 *
 * A factory rather than an inline lambda at the composition root, so that root states WHICH
 * dependency answers this question and nothing about how the answer is shaped.
 */
export function agentModelDefaultsPort(agents: {
  listAgents: (
    userId: string,
    opts?: { projectId?: string | null },
  ) => Promise<Pick<AgentSummary, 'record'>[]>
}) {
  // A card's model is one link of a chain that falls through to the next, so an unreadable
  // registry skips the link rather than failing the run — but says so: silently skipping it made
  // an agent run on a model its card never named, with nothing to explain why.
  return async (userId: string, projectId: string | null) =>
    agentModelDefaults(
      await agents.listAgents(userId, { projectId }).catch((error: unknown) => {
        console.warn('[agents] card models unavailable for this run:', error)
        return []
      }),
    )
}

/** Card-authored route for each agent that states one, keyed by agent ID. */
export function agentModelDefaults(
  agents: readonly Pick<AgentSummary, 'record'>[],
): Map<string, AgentRoute> {
  const routes = new Map<string, AgentRoute>()
  for (const agent of agents) {
    const preference = agent.record.modelPreference
    if (!preference?.model && !preference?.effort) continue
    // A card names a provider and a model, while a run wants one identifier: the provider is
    // prefixed unless the model already carries one.
    const route =
      preference.model && preference.provider && !preference.model.includes('/')
        ? `${preference.provider}/${preference.model}`
        : undefined
    const answer = agentModelRoute(
      {
        ...(route ? { route } : { model: preference.model }),
        effort: preference.effort,
      },
      {},
    ).route
    if (Object.keys(answer).length > 0) routes.set(agent.record.id, answer)
  }
  return routes
}
