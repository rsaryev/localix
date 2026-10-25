import { useMemo, useState } from 'react'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { agentScopeValue } from '@/shared/api/capabilityScope'
import { useAgents } from '@/shared/contrib/useAgents'
import { useActiveSessionAgentId } from '@/entities/chat/model/store'

/**
 * WHOSE rules a Settings page reads and writes: the agent its picker names.
 *
 * It OPENS on the agent of the chat you came from. Every page that uses it answers "what may
 * this agent do", and the question a person has while looking at a conversation is about the
 * agent in it — landing on the default assistant meant reading, and worse editing, the wrong
 * list. A manual pick wins from then on: following the session afterwards would drag the page
 * out from under someone who had deliberately gone to look at another role.
 */
export function useRulesAgent(project: string) {
  const { agents } = useAgents(project)
  const pickable = useMemo(
    () => agents.map(({ record }) => ({ id: record.id, label: record.label || record.handle })),
    [agents],
  )
  const [picked, setPicked] = useState<string | null>(null)
  const sessionAgentId = useActiveSessionAgentId()
  // An id the picker cannot offer (a sub-agent's, a project the page is not showing) falls
  // back to the default rather than selecting a row that is not there.
  const fromSession = pickable.some((agent) => agent.id === sessionAgentId)
    ? (sessionAgentId ?? '')
    : ''
  const agentId = picked ?? fromSession
  return {
    agents: pickable,
    agentId,
    agentScope: agentScopeValue(agentId || DEFAULT_AGENT_ID),
    pick: setPicked,
  }
}
