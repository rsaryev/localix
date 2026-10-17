import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import type { ChatStore } from './store'
import { inheritedAgentId } from './newChatAgent'

export type ConversationScopeStrategy =
  | { kind: 'active' }
  | { kind: 'default' }
  | { kind: 'scope'; projectId: string }

export type ConversationParticipantStrategy =
  | { kind: 'inherit' }
  | { kind: 'default' }
  | { kind: 'agent'; agentId: string }

/**
 * Everything that can differ between ways of starting a one-agent conversation.
 *
 * UI locations choose a strategy; the store resolves it. Keeping scope and participant
 * independent is what lets a rail button, an agent-group plus and an implicit first send
 * share one creation pipeline without smuggling location-specific booleans into it.
 *
 * Every entry point shares one creation lane. Only a fresh untouched draft created by this
 * workspace is eligible for reuse, with the same project and exactly one matching participant.
 * Saved history and drafts created by another workspace never substitute for a new chat. A
 * `landing` is not a new chat: it only needs one to show, so the server may hand back any
 * untouched chat of that project.
 */
export interface ConversationStartStrategy {
  scope: ConversationScopeStrategy
  participant: ConversationParticipantStrategy
  /**
   * A landing (home, launch, a project opened with no chat), not the New chat gesture: any
   * window may reopen the project's newest untouched chat, which the server finds or creates
   * in one serialized step so windows landing together converge on one chat.
   */
  landing?: boolean
}

export const activeConversationDraft = (): ConversationStartStrategy => ({
  scope: { kind: 'active' },
  participant: { kind: 'inherit' },
})

/** The ordinary New-chat gesture in a known URL scope. */
export const scopedNewConversation = (
  projectId: string | null,
  participant: ConversationParticipantStrategy = { kind: 'inherit' },
  landing = false,
): ConversationStartStrategy => ({
  ...(landing ? { landing } : {}),
  // `null` is the unresolved neutral route, not a project-less workspace. Keep that intent
  // explicit so it cannot accidentally inherit whichever project is still active in Zustand.
  scope: projectId === null ? { kind: 'default' } : { kind: 'scope', projectId },
  participant,
})

export interface ResolvedConversationStart {
  projectId: string | null
  agentId: string
  /** Only an inherited agent is a guess that may safely fall back to the server default. */
  fallbackWhenAgentUnavailable: boolean
}

const DEFAULT_SCOPE_LATCH_KEY = '__default__'

/**
 * Keys that identify one creation lane while the project roster is allowed to hydrate.
 *
 * The default project has two observable spellings during startup: unresolved (`null`) and its
 * real id once projects arrive. Aliasing both prevents that transition from bypassing the
 * in-flight latch and creating two empty chats.
 */
export function conversationCreationLatchKeys(
  state: Pick<ChatStore, 'projects'>,
  plan: Pick<ResolvedConversationStart, 'projectId'>,
): readonly string[] {
  const primary = plan.projectId ?? DEFAULT_SCOPE_LATCH_KEY
  const isDefault =
    plan.projectId === null ||
    state.projects.some((project) => project.isDefault && project.id === plan.projectId)
  return isDefault && primary !== DEFAULT_SCOPE_LATCH_KEY
    ? [primary, DEFAULT_SCOPE_LATCH_KEY]
    : [primary]
}

/** Resolve a strategy once so reuse, request and fallback all act on the same decision. */
export function resolveConversationStart(
  state: ChatStore,
  strategy: ConversationStartStrategy,
): ResolvedConversationStart {
  const projectId =
    strategy.scope.kind === 'scope'
      ? strategy.scope.projectId
      : strategy.scope.kind === 'default'
        ? (state.projects.find((project) => project.isDefault)?.id ?? null)
        : (state.activeProjectId ?? null)
  const inherited =
    strategy.participant.kind === 'inherit' ? inheritedAgentId(state, projectId) : undefined
  const agentId =
    strategy.participant.kind === 'agent'
      ? strategy.participant.agentId
      : strategy.participant.kind === 'default'
        ? DEFAULT_AGENT_ID
        : (inherited ?? DEFAULT_AGENT_ID)

  return {
    projectId,
    agentId,
    fallbackWhenAgentUnavailable:
      strategy.participant.kind === 'inherit' && inherited !== undefined,
  }
}
