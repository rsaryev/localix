import type { z } from 'zod'

import type { reasoningEffortSchema } from './session'

/** A model choice as the wire carries it: model, the connection it binds and the level. */
export interface ModelChoiceView {
  providerConnectionId: string | null
  modelId: string
  reasoningEffort: z.infer<typeof reasoningEffortSchema>
}

/**
 * `SessionSummary.modelChoices`: the person's choices in a session, independent of membership —
 * per agent, seated or not (a model can be set before an invitation). An agent that joins starts
 * on its entry; runs read the seat. "All" is not stored: it is the same choice on every agent.
 */
export interface SessionModelChoicesView {
  agents: Record<string, ModelChoiceView>
}

/**
 * `GET /sessions/:id/join-routes`: what an agent not invited yet would join this conversation on
 * when the session holds no choice for it — its card, else its last pick, else the project
 * (`agent-route-resolution.ts`). `fallback` answers for every agent `agents` does not name.
 */
export interface JoinRoutesView {
  agents: Record<string, ModelChoiceView>
  fallback: ModelChoiceView | null
}
