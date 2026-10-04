import { useCallback, useMemo } from 'react'
import { canJoinConversation } from '@localixai/api/agent-policy'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

import type { UiSession } from '@/shared/api/contracts'
import { toast } from '@/shared/lib/notify'
import { useAgents } from '@/features/settings/model/useAgents'
import { scopedNewConversation } from './conversationStartStrategy'
import { useChatStore } from './store'
import { useAgentJump } from './useBreadcrumbNav'

/**
 * The breadcrumb's agent segment: which agents a chat can be with, and the jump to one of them —
 * its latest chat in this scope, or a new chat when it has none.
 *
 * Model, not view: the segment only renders a list and calls a function, while deciding who may
 * join a conversation and how a new chat starts in the active scope is the same policy every other
 * New-chat entry point follows.
 */
export function useCrumbAgents(input: {
  allSessions: UiSession[]
  activeProjectId: string | null
  goToSession: (id: string) => void
}) {
  const { allSessions, activeProjectId, goToSession } = input
  const createSession = useChatStore((s) => s.createSession)
  const { agents } = useAgents(activeProjectId ?? '')
  const chatAgents = useMemo(
    () =>
      agents
        .filter(canJoinConversation)
        .map((agent) => ({ name: agent.record.handle, label: agent.record.label })),
    [agents],
  )
  const createChatWith = useCallback(
    async (handle: string) => {
      const selected = agents.find((agent) => agent.record.handle === handle)
      if (!selected) return undefined
      // The dropdown fires this as `void`, so a rejected create would vanish unseen and
      // the crumb would simply not move. Say it, like every other New-chat entry point.
      const created = await createSession(
        undefined,
        scopedNewConversation(activeProjectId, { kind: 'agent', agentId: selected.record.id }),
      ).catch((e: unknown) => {
        toast.error('Could not start a new conversation', {
          description: errorMessage(e, '') || undefined,
        })
        return null
      })
      return created?.id
    },
    [createSession, activeProjectId, agents],
  )
  const jumpToAgent = useAgentJump(allSessions, activeProjectId, goToSession, createChatWith)
  return { chatAgents, jumpToAgent }
}
