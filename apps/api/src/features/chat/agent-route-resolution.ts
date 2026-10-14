/**
 * WHAT ONE PARTICIPANT RUNS ON, DECIDED IN ONE PLACE.
 *
 * A model can be chosen in four places, and until this module each of them was applied by
 * whoever happened to be nearby: the session seeded a route at birth from whatever the user last
 * used, the project's default was consulted only at that same moment, and the model on the
 * agent's own card was read by one dispatcher and by nobody else. Several writers, no
 * order between them, and a seat that always held a concrete string — so "this participant has
 * no model of its own" could not even be expressed, let alone inherited.
 *
 * The order is stated once, here, from the most specific statement to the most general:
 *
 *   1. THE SESSION — you picked this model for this participant in this conversation.
 *   2. YOUR LAST CHOICE FOR THIS AGENT — the freshest model you selected for it.
 *   3. THE AGENT'S CARD — its explicit default, editable only in agent settings.
 *   4. THE PROJECT — a fallback when the agent has neither history nor its own default.
 *   5. THE PRIMARY PARTICIPANT — the room's main model when this participant has no choice at
 *      any level. A valid room must not strand one specialist on "No model selected" while its
 *      leader is already running on a usable model.
 *
 * WHY RECENT SITS ABOVE THE DEFAULTS. Selecting a model for an agent teaches routing what this
 * installation prefers for that agent; it does not rewrite the authored definition. The card is
 * the starting default until the first selection, and it can be changed only in agent settings.
 * The learned choice is per agent so `researcher` never inherits what was picked for `frontend`.
 *
 * THE MODEL FALLS THROUGH ON READ; THE EFFORT IS DECIDED AT BIRTH. They differ because the
 * questions differ. "Which model is this participant on" is a standing fact, so a blank seat
 * asks the chain again on every read and a project default changed today reaches yesterday's
 * conversations. "How hard to think" is a dial for the task in front of you: a conversation
 * started on `high` must stay on `high` when the agent's card later says `low`. So the chain
 * answers it once, when the seat is created, and the seat owns it from then on.
 *
 * Nothing here reads a database or a file. The caller gathers the candidates and this decides
 * between them, which is what lets the same decision serve a run, the read model the picker
 * draws, and a test, without any of them re-deriving it.
 */
import type { ModelRoute, SessionAgentRoute } from './repository-types'

/** Where an effective value came from. The picker says "own model" or "from the project" with it. */
export type RouteOrigin = 'session' | 'project' | 'recent' | 'agent' | 'primary' | 'unset'

/** One candidate in the chain: a partial route plus the name it answers to. */
export interface RouteCandidate {
  origin: Exclude<RouteOrigin, 'unset'>
  route: Partial<ModelRoute> | null | undefined
}

/** The levels a caller gathers, named. Any of them may be absent. */
export interface RouteSources {
  /** What this conversation stores for this participant. A blank field means "not chosen here". */
  seat?: Partial<ModelRoute> | null
  /** The project's default route. */
  project?: Partial<ModelRoute> | null
  /** The last route the user chose for THIS agent, in any conversation. */
  recentForAgent?: Partial<ModelRoute> | null
  /** The model on the agent's own card in settings. */
  agent?: Partial<ModelRoute> | null
}

/**
 * The chain, in order, as candidates. The ONE statement of precedence; every reader of a
 * participant's model and every seat being born goes through this list.
 */
export function routeCandidates(sources: RouteSources): RouteCandidate[] {
  return [
    { origin: 'session', route: sources.seat },
    { origin: 'recent', route: sources.recentForAgent },
    { origin: 'agent', route: sources.agent },
    { origin: 'project', route: sources.project },
  ]
}

/** A value counts as chosen only when it is actually there — '' is how "not set" is stored. */
const hasModel = (route: Partial<ModelRoute> | null | undefined): boolean =>
  typeof route?.modelId === 'string' && route.modelId.length > 0

/** What the chain says a participant's model is, and which level said it. */
export interface ResolvedModel {
  modelId: string
  providerConnectionId: string | null
  modelOrigin: RouteOrigin
}

/**
 * Decide one participant's model and connection from the chain.
 *
 * The connection travels WITH the model, never separately: a connection is the credentials a
 * model is reached through, and pairing one candidate's model with another's connection is how
 * a run ends up authenticating to the wrong provider. So whichever candidate supplies the model
 * supplies the connection too, even when that connection is null — a null one is not a failure,
 * it is a card saying "I name a model, not your credentials", and the run binds a live
 * connection for that model's provider itself.
 */
export function resolveModel(candidates: readonly RouteCandidate[]): ResolvedModel {
  const winner = candidates.find((candidate) => hasModel(candidate.route))
  return {
    modelId: winner?.route?.modelId ?? '',
    providerConnectionId: winner?.route?.providerConnectionId ?? null,
    modelOrigin: winner?.origin ?? 'unset',
  }
}

export const DEFAULT_ROUTE_EFFORT = 'medium'

/**
 * Decide the effort a seat is BORN with. Used once per seat, never on read.
 *
 * Falls through the same chain as the model but on its own: a participant given a model here
 * and no effort takes the effort from the next level rather than losing the model because the
 * pair was incomplete — the alternative makes "set one thing" silently unset another.
 */
export function seedEffort(
  candidates: readonly RouteCandidate[],
): NonNullable<ModelRoute['reasoningEffort']> {
  return (
    candidates.find((candidate) => candidate.route?.reasoningEffort)?.route?.reasoningEffort ??
    DEFAULT_ROUTE_EFFORT
  )
}

/** One seated participant's model, through the chain. */
export const resolveSeatModel = (sources: RouteSources): ResolvedModel =>
  resolveModel(routeCandidates(sources))

/**
 * Apply the chain to a whole party, keeping identity, order and each seat's effort untouched.
 *
 * The effort is deliberately passed through: it was decided when the seat was created, and
 * re-deriving it here would let a level changed since then move a running conversation's dial.
 */
export function resolveParty(
  party: readonly SessionAgentRoute[],
  defaults: Omit<RouteSources, 'seat' | 'recentForAgent'> & {
    /** The card of one agent, by ID. Absent means the agent states no preference. */
    agent?: (agentId: string) => Partial<ModelRoute> | null | undefined
    /** The user's last explicit choice for one agent, by ID. */
    recentForAgent?: (agentId: string) => Partial<ModelRoute> | null | undefined
  },
): (SessionAgentRoute & ResolvedModel)[] {
  const resolved = party.map((member) => ({
    ...member,
    ...resolveSeatModel({
      seat: member,
      project: defaults.project,
      recentForAgent: defaults.recentForAgent?.(member.agentId),
      agent: defaults.agent?.(member.agentId),
    }),
  }))
  const primary = resolved[0]
  if (!primary?.modelId) return resolved
  return resolved.map((member, index) =>
    index === 0 || member.modelId
      ? member
      : {
          ...member,
          providerConnectionId: primary.providerConnectionId,
          modelId: primary.modelId,
          modelOrigin: 'primary' as const,
        },
  )
}
