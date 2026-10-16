import type { RosterRow } from '@localixai/api/external-agent-contracts'
import type { SessionGroupingMode } from '@/features/chat/model/sessionGrouping'
import type { SortMode } from '@/features/chat/model/useSidebarSessions'
import type { externalHistoryGroups } from './historyGroups'

export type HistoryGroup = ReturnType<typeof externalHistoryGroups>[number]
export type HistoryRow =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'agent'; id: string; provider: string; count: number }
  | { kind: 'session'; id: string; session: RosterRow }
  | { kind: 'more'; id: string }

export function externalHistoryRows(
  groups: HistoryGroup[],
  collapsed: ReadonlySet<string>,
  hasMore: boolean,
  groupingMode: SessionGroupingMode,
  sortMode: SortMode,
): HistoryRow[] {
  const rows: HistoryRow[] = []
  const appendAgent = (id: string, provider: string, sessions: RosterRow[]) => {
    rows.push({ kind: 'agent', id, provider, count: sessions.length })
    if (collapsed.has(id)) return
    const sorted = [...sessions].sort((a, b) =>
      sortMode === 'title'
        ? a.title.localeCompare(b.title) || b.updatedAt - a.updatedAt
        : b.updatedAt - a.updatedAt,
    )
    rows.push(
      ...sorted.map((session): HistoryRow => ({ kind: 'session', id: session.key, session })),
    )
  }
  if (groupingMode === 'agent') {
    const agents = new Map<string, RosterRow[]>()
    for (const day of groups)
      for (const agent of day.agents)
        agents.set(agent.id, [...(agents.get(agent.id) ?? []), ...agent.sessions])
    for (const [provider, sessions] of agents) appendAgent(`agent:${provider}`, provider, sessions)
  } else {
    for (const day of groups) {
      rows.push({ kind: 'day', id: day.id, label: day.label })
      for (const agent of day.agents) appendAgent(`${day.id}:${agent.id}`, agent.id, agent.sessions)
    }
  }
  if (hasMore) rows.push({ kind: 'more', id: 'more' })
  return rows
}
