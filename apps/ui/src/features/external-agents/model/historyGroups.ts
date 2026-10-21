import type { RosterRow } from '@localixai/api/external-agent-contracts'
import { activitySessionGroups } from '@/entities/chat/model/sessionGrouping'

export function externalHistoryGroups(sessions: readonly RosterRow[], now = Date.now()) {
  return activitySessionGroups(sessions, now).map((day) => {
    const agents = new Map<string, RosterRow[]>()
    for (const session of day.sessions) {
      const group = agents.get(session.provider) ?? []
      group.push(session)
      agents.set(session.provider, group)
    }
    return {
      id: day.id,
      label: day.label,
      agents: [...agents].map(([id, rows]) => ({ id, sessions: rows })),
    }
  })
}
