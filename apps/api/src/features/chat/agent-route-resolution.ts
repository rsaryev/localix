/**
 * WHAT A NEW SEAT STARTS ON, DECIDED ONCE.
 *
 * A participant's seat (`conversation_participants`) is the ONE source of truth for what it runs
 * on: model, connection and reasoning effort are always stored explicitly. Nothing is resolved
 * on read and nothing is inherited later — a project default or an agent card changed tomorrow
 * reaches new seats, never a conversation that already exists.
 *
 * This module is the only place that decides a seat's starting route. It runs when a seat is
 * born (a new conversation, an invited participant) and once for a legacy seat stored blank.
 *
 *   MODEL:  what the caller asked for (for a newcomer: the session's choice for it —
 *           `session-model-choices.ts`) → the agent's card (its own default model) → the model
 *           this agent used most recently (your last pick for it, in any conversation) → the
 *           project. Never another participant's model. A new chat is not seeded with anything:
 *           every seat resolves through this chain.
 *   EFFORT: what the caller asked for → the level of that last pick, when the model came from it
 *           → the level last chosen for THAT model and agent → the agent's card → the default.
 *           Never another model's level, never another participant's.
 *
 * Nothing here reads a database or a file; the caller gathers the sources.
 */
import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import type { ReasoningEffort } from '../../db/types'
import type { ModelRoute } from './repository-types'

/**
 * Where a seat's starting model came from. Only `session` is a user's own choice; `primary` is
 * a delegated child's snapshot of its parent (`seedParticipants`), never a newcomer's.
 */
export type RouteOrigin = 'session' | 'project' | 'recent' | 'agent' | 'primary' | 'unset'

export interface SeatSources {
  /** What the caller explicitly asked for (a model, an effort, or both). Always wins. */
  chosen?: Partial<ModelRoute> | null
  /** The last model the user chose for THIS agent, in any conversation. */
  recentForAgent?: Partial<ModelRoute> | null
  /** The route on the agent's own card in settings. */
  agent?: Partial<ModelRoute> | null
  /** The project's default route. */
  project?: Partial<ModelRoute> | null
  /** The level last chosen for this agent on one model, if any. */
  effortForModel?: (modelId: string) => ReasoningEffort | undefined
}

export interface SeatRoute extends ModelRoute {
  modelOrigin: RouteOrigin
}

const hasModel = (route: Partial<ModelRoute> | null | undefined): boolean =>
  typeof route?.modelId === 'string' && route.modelId.length > 0

/** The complete route a new seat is stored with. */
export function birthRoute(sources: SeatSources): SeatRoute {
  const candidates: [
    Exclude<RouteOrigin, 'unset' | 'primary'>,
    Partial<ModelRoute> | null | undefined,
  ][] = [
    ['session', sources.chosen],
    ['agent', sources.agent],
    ['recent', sources.recentForAgent],
    ['project', sources.project],
  ]
  const winner = candidates.find(([, route]) => hasModel(route))
  const modelId = winner?.[1]?.modelId ?? ''
  return {
    modelId,
    // The connection travels with the model: pairing one source's model with another's
    // connection is how a run authenticates to the wrong provider.
    providerConnectionId: winner?.[1]?.providerConnectionId ?? null,
    modelOrigin: winner?.[0] ?? 'unset',
    reasoningEffort:
      sources.chosen?.reasoningEffort ??
      (winner?.[0] === 'recent' ? sources.recentForAgent?.reasoningEffort : undefined) ??
      (modelId ? sources.effortForModel?.(modelId) : undefined) ??
      sources.agent?.reasoningEffort ??
      DEFAULT_REASONING_EFFORT,
  }
}
