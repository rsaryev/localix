import { useCallback } from 'react'

import type { AgentSummary } from '@/shared/api/contracts'
import { scopedNewConversation, type ConversationStartStrategy } from './conversationStartStrategy'

export function useSidebarNewChat(
  projectId: string | null,
  agents: readonly AgentSummary[],
  start: (strategy: ConversationStartStrategy) => void,
) {
  return useCallback(
    (handle?: string) => {
      const agentId = handle
        ? agents.find((entry) => entry.record.handle === handle)?.record.id
        : undefined
      if (handle && !agentId) return
      start(
        scopedNewConversation(
          projectId,
          agentId ? { kind: 'agent', agentId } : { kind: 'inherit' },
        ),
      )
    },
    [agents, projectId, start],
  )
}
