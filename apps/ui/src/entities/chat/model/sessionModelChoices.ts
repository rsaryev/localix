import type { ModelChoiceView, SessionModelChoicesView, UiSession } from '@/shared/api/contracts'

/**
 * THE SESSION'S MODEL CHOICES AS THE BROWSER PAINTS THEM — the mirror of the server's
 * `session-model-choices.ts`. A seated agent runs on its seat; an agent not invited yet shows
 * the session's choice for it, else what it would join on (`JoinRoutesView`).
 */
export type ModelChoice = ModelChoiceView

const NONE: SessionModelChoicesView = { agents: {} }

/** The session's own choice for an agent, if one was made here. */
export function choiceFor(
  choices: SessionModelChoicesView | undefined,
  agentId: string,
): ModelChoice | null {
  return choices?.agents[agentId] ?? null
}

/** A partial pick landed on what it changes, as the server lands it. */
function land(base: ModelChoice | null, route: Partial<ModelChoice>): ModelChoice | null {
  if (route.modelId) {
    return {
      modelId: route.modelId,
      providerConnectionId: route.providerConnectionId ?? null,
      reasoningEffort: route.reasoningEffort ?? base?.reasoningEffort ?? 'medium',
    }
  }
  return base
    ? {
        ...base,
        ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
      }
    : null
}

/** The optimistic paint of a pick: each named agent's choice. */
export function withModelChoices(
  session: UiSession,
  routes: readonly ({ agentId: string } & Partial<ModelChoice>)[],
): UiSession {
  const choices = session.modelChoices ?? NONE
  const agents = { ...choices.agents }
  for (const { agentId, ...route } of routes) {
    const seat = session.agents.find((member) => member.agentId === agentId)
    const landed = land(seat?.modelId ? seat : choiceFor(choices, agentId), route)
    if (landed) agents[agentId] = landed
  }
  return {
    ...session,
    modelChoices: { agents },
  }
}
