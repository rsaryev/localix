import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import type { ReasoningEffort } from '../../db'
import { safeJsonParse } from '../../lib/json'
import type { ModelRoute } from './repository-types'

/**
 * WHAT THE PERSON CHOSE FOR EACH AGENT IN ONE SESSION — independent of who is in it.
 *
 * A participant's seat (`conversation_participants`) is what a run reads. This map is where a
 * choice is remembered for agents that are not seated yet, so a model can be configured before an
 * invitation and survives a leave-and-rejoin. There is no session-wide choice: "All" in the
 * picker is a cascade that writes the same route to every listed agent, one entry each.
 *
 * Joining is the only moment the map decides a seat ({@link choiceFor}); after that the seat and
 * its entry are written together by the one choice writer (`repository-model-choices.ts`).
 */
export interface SessionModelChoices {
  agents: Record<string, ModelRoute>
  /**
   * When each entry was picked (ISO). Stored, never on the wire: it is how "the model this agent
   * used most recently" reads a pick made for an agent that was never seated
   * (`repository-recent-routes.ts`).
   */
  chosenAt?: Record<string, string>
}

export type ModelChoiceRoute = { agentId: string } & Partial<ModelRoute>

export const emptyModelChoices = (): SessionModelChoices => ({ agents: {} })

function toRoute(value: unknown): ModelRoute | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.modelId !== 'string' || !row.modelId) return null
  return {
    modelId: row.modelId,
    providerConnectionId:
      typeof row.providerConnectionId === 'string' ? row.providerConnectionId : null,
    reasoningEffort: (typeof row.reasoningEffort === 'string'
      ? row.reasoningEffort
      : DEFAULT_REASONING_EFFORT) as ReasoningEffort,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * The stored column → the domain shape. Anything malformed reads as "nothing chosen"; a legacy
 * `all` key (an all-agents choice that no longer exists) is ignored.
 */
export function parseModelChoices(raw: string | null | undefined): SessionModelChoices {
  const parsed = safeJsonParse<unknown>(raw)
  if (!isRecord(parsed)) return emptyModelChoices()
  const agents: Record<string, ModelRoute> = {}
  const chosenAt: Record<string, string> = {}
  const stamps = isRecord(parsed.chosenAt) ? parsed.chosenAt : {}
  if (isRecord(parsed.agents)) {
    for (const [agentId, value] of Object.entries(parsed.agents)) {
      const route = toRoute(value)
      if (!route) continue
      agents[agentId] = route
      const at = stamps[agentId]
      if (typeof at === 'string') chosenAt[agentId] = at
    }
  }
  return Object.keys(chosenAt).length ? { agents, chosenAt } : { agents }
}

/** The choices as a session record carries them: the stamps stay in storage. */
export const unstampedChoices = (choices: SessionModelChoices): SessionModelChoices => ({
  agents: choices.agents,
})

/** What an agent joining this session starts on: the session's own choice for it, if any. */
export function choiceFor(
  choices: SessionModelChoices | undefined,
  agentId: string,
): ModelRoute | null {
  return choices?.agents[agentId] ?? null
}

/**
 * A partial statement landed on what it changes. A model names its connection (absent = none:
 * a model must bind afresh rather than keep another model's connection) and keeps the previous
 * level unless it states one; a level alone needs a model to belong to, else it is dropped.
 */
function landRoute(base: ModelRoute | null, route: Partial<ModelRoute>): ModelRoute | null {
  if (route.modelId) {
    return {
      modelId: route.modelId,
      providerConnectionId: route.providerConnectionId ?? null,
      reasoningEffort: route.reasoningEffort ?? base?.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    }
  }
  if (!base) return null
  return {
    ...base,
    ...(route.providerConnectionId !== undefined
      ? { providerConnectionId: route.providerConnectionId }
      : {}),
    ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
  }
}

/**
 * Record a choice. Each named agent's entry is landed on what that agent runs on now — its
 * seat, else its entry — and stamped `at`. Nothing else moves: picking for one agent never
 * touches another's entry.
 */
export function recordModelChoices(
  choices: SessionModelChoices,
  seats: ReadonlyMap<string, ModelRoute>,
  routes: readonly ModelChoiceRoute[],
  at: string,
): SessionModelChoices {
  const agents = { ...choices.agents }
  const chosenAt = { ...choices.chosenAt }
  for (const { agentId, ...route } of routes) {
    const seat = seats.get(agentId)
    const landed = landRoute(seat?.modelId ? seat : choiceFor(choices, agentId), route)
    if (!landed) continue
    agents[agentId] = landed
    chosenAt[agentId] = at
  }
  return { agents, chosenAt }
}
