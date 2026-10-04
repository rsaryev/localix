import { ApiError } from '@/shared/api/failure'
import { findSessionInState } from './findSession'
import type { ChatStore } from './store'

/**
 * Whom a new chat should be with when nobody said — the agent of the chat you are in.
 *
 * "New chat" says nothing about an agent, and the server's answer for "nobody said" is the
 * default assistant. So pressing + while talking to @qa dropped you into a chat with somebody
 * else, and the agent menu was the only way back. Continuing with the same counterpart is the
 * common case; changing it is the deliberate one, and it has its own control.
 *
 * Two conditions, and both are about the inheritance being able to HOLD rather than about
 * taste. The scope must match, because an agent can be project-scoped and naming one the
 * target project cannot resolve is a 404 instead of a chat. And the session must be a real
 * `chat`: a worker or a dispatched job runs a role that may not be admitted to a conversation at
 * all, so inheriting from a transcript you happen to be reading would start nothing.
 */
export function inheritedAgentId(
  state: ChatStore,
  targetProjectId: string | null,
): string | undefined {
  const active = state.activeSessionId
    ? findSessionInState(state, state.activeSessionId)
    : undefined
  if (!active || (active.sessionKind ?? 'chat') !== 'chat') return undefined
  if ((active.projectId ?? null) !== targetProjectId) return undefined
  // The party head directly, not `sessionRoute`: its blank fallback answers with the default
  // agent's id for a session whose party never committed, and turning a broken record into an
  // explicit request is not inheritance — it is inventing one.
  return active.agents?.[0]?.agentId || undefined
}

/** The server's answer for an agent that is withdrawn, or not allowed in a chat. */
export const isAgentUnavailable = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'agent_unavailable'
