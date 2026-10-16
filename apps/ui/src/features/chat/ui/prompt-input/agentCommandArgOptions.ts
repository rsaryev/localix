import { backendClient } from '@/shared/api/client'
import type { SlashArgOption } from './SlashArgSpec'

/** Fetch the command's own scope, which may differ from the currently visible workspace. */
export async function loadAgentCommandArgOptions(
  action: string | undefined,
  query: string,
  sessionId: string | null,
  projectId: string | null,
): Promise<SlashArgOption[]> {
  const [snapshot, session] = await Promise.all([
    backendClient.fetchCapabilitySnapshot({ projectId: projectId ?? '' }),
    (action === 'remove' || action === 'add') && sessionId
      ? backendClient.getSession(sessionId)
      : Promise.resolve(null),
  ])
  const members = new Set(session?.agents.map((member) => member.agentId) ?? [])
  const q = query.replace(/^@/, '').toLowerCase()
  if (action === 'remove') {
    return (session?.agents ?? [])
      .filter(
        (member) =>
          member.handle.toLowerCase().includes(q) || member.agentId.toLowerCase().includes(q),
      )
      .slice(0, 40)
      .map((member) => ({
        value: member.agentId,
        label: `@${member.handle}`,
        description: 'Remove from this chat',
      }))
  }
  return snapshot.agents
    .filter((agent) => {
      if (
        action === 'add' &&
        (members.has(agent.record.id) || !agent.enabled || agent.invocations.chat !== 'allow')
      )
        return false
      if (action === 'enable' && agent.enabled) return false
      if (action === 'disable' && !agent.enabled) return false
      return (
        agent.record.handle.toLowerCase().includes(q) ||
        agent.record.description.toLowerCase().includes(q)
      )
    })
    .slice(0, 40)
    .map((agent) => ({
      value: `@${agent.record.handle}`,
      label: agent.record.label || agent.record.handle,
      description: agent.record.description || (agent.enabled ? 'Enabled' : 'Disabled'),
    }))
}
