/**
 * The model the person chose for an agent: the `agent` link of a conversation's model chain (see
 * `chat/agent-route-resolution.ts`). It is read from Localix's own settings
 * (`agentSettings.agentModelChoices`), never from the agent's file, whose `model` and `effort`
 * nothing here reads.
 */
import {
  agentChoiceRoute,
  type AgentModelChoice,
  type AgentRoute,
} from '../agent-core/agent-model-route'

/** The port the chat service is handed: read the person's choices, answer one route per agent. */
export function agentModelDefaultsPort(
  readChoices: (userId: string) => Promise<readonly AgentModelChoice[] | undefined>,
) {
  // An unreadable setting skips the link rather than failing the run, and says so.
  return async (userId: string, _projectId: string | null) =>
    agentModelDefaults(
      await readChoices(userId).catch((error: unknown) => {
        console.warn('[agents] chosen models unavailable for this run:', error)
        return undefined
      }),
    )
}

/** The route the person chose for each agent that has a choice, keyed by agent ID. */
export function agentModelDefaults(
  choices: readonly AgentModelChoice[] | undefined,
): Map<string, AgentRoute> {
  const routes = new Map<string, AgentRoute>()
  for (const { agentId } of choices ?? []) {
    const route = agentChoiceRoute(choices, agentId)
    if (Object.keys(route).length > 0) routes.set(agentId, route)
  }
  return routes
}
