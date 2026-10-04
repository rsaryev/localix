import { useCallback, useMemo } from 'react'
import { groupParticipants, isConversationGroup } from './sessionGroups'
import type { Project, UiSession } from '@/shared/api/contracts'
import type { BreadcrumbSelectItem } from '@localixai/kit/breadcrumb-select'
import { latestChatWith, sessionAgentHandle } from './sessionGroups'
import { scopeRootSessions } from './useSidebarSessions'

/**
 * What each breadcrumb dropdown offers, and what picking an entry does.
 *
 * Split from the bar itself because the bar is layout — which crumb truncates first, where the
 * separators go — while this is the navigation model: three levels, each switching at its own
 * level, and the rule that a level only ever offers what lives INSIDE the level above it.
 *
 * That last rule is the whole reason this is worth its own module. The session dropdown used
 * to list every root chat in the scope, so standing in `Global / Backend / a chat` it offered
 * chats belonging to other agents — a path whose last segment could take you out of the path.
 */
export interface BreadcrumbNavDeps {
  allSessions: UiSession[]
  activeProjectId: string | null
  activeSessionId: string | null
  projects: Project[]
  /** The branch the trail is in, taken from the ROOT chat. Absent when nothing is open. */
  currentAgent: string | undefined
  /** Chat-capable agents, already filtered to the enabled ones, in registry order. */
  chatAgents: readonly { name: string; label?: string }[]
  goToSession: (id: string) => void
  startChatWith: (handle: string) => Promise<void> | void
}

export interface BreadcrumbNav {
  agentItems: BreadcrumbSelectItem[]
  sessionItems: BreadcrumbSelectItem[]
  /** What the agent crumb reads, falling back to the handle when the registry has no label. */
  currentAgentLabel: string | undefined
}

/**
 * The chats the session crumb may offer: this scope's, and this agent's.
 *
 * Exported for its test — the containment rule is the part that was wrong, and the part a
 * future change is most likely to get wrong again.
 */
export function sessionsInBranch(
  allSessions: UiSession[],
  activeProjectId: string | null,
  currentAgent: string | undefined,
): UiSession[] {
  const scoped = scopeRootSessions(allSessions, activeProjectId, false)
  if (!currentAgent) return scoped
  return scoped.filter((session) => sessionAgentHandle(session) === currentAgent)
}

export function useBreadcrumbNav({
  allSessions,
  activeProjectId,
  activeSessionId,
  currentAgent,
  chatAgents,
  goToSession,
  startChatWith,
}: BreadcrumbNavDeps): BreadcrumbNav {
  const agentItems = useMemo<BreadcrumbSelectItem[]>(
    () =>
      chatAgents.map((agent) => ({
        id: agent.name,
        label: agent.label || agent.name,
        active: agent.name === currentAgent,
        onSelect: () => void startChatWith(agent.name),
      })),
    [chatAgents, currentAgent, startChatWith],
  )

  const sessionItems = useMemo<BreadcrumbSelectItem[]>(
    () =>
      sessionsInBranch(allSessions, activeProjectId, currentAgent).map((session) => ({
        id: session.id,
        label: session.title || 'Untitled Chat',
        active: session.id === activeSessionId,
        onSelect: () => goToSession(session.id),
      })),
    [allSessions, activeProjectId, currentAgent, activeSessionId, goToSession],
  )

  // A conversation key names a SET of agents, so its crumb reads as the participants, not as one
  // of them and not as the raw key.
  const labelOf = (handle: string) =>
    chatAgents.find((agent) => agent.name === handle)?.label ?? handle
  const currentAgentLabel =
    currentAgent === undefined
      ? undefined
      : isConversationGroup(currentAgent)
        ? groupParticipants(currentAgent).map(labelOf).join(', ')
        : labelOf(currentAgent)

  return { agentItems, sessionItems, currentAgentLabel }
}

/**
 * Where picking an agent lands: their most recent chat, or a new one.
 *
 * A callback factory rather than a branch inside the component, so the "and start one when
 * they have none" half cannot be forgotten by a caller — an agent you have never used is
 * exactly the case a roster in a breadcrumb has to answer for.
 */
export function useAgentJump(
  allSessions: UiSession[],
  activeProjectId: string | null,
  goToSession: (id: string) => void,
  createChat: (handle: string) => Promise<string | undefined>,
): (handle: string) => Promise<void> {
  return useCallback(
    async (handle: string) => {
      const latest = latestChatWith(scopeRootSessions(allSessions, activeProjectId, false), handle)
      if (latest) {
        goToSession(latest.id)
        return
      }
      const created = await createChat(handle)
      if (created) goToSession(created)
    },
    [allSessions, activeProjectId, goToSession, createChat],
  )
}
