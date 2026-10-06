import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Bot, ChevronRight } from 'lucide-react'
import { ClaudeMark, CodexMark } from '@localixai/kit/coding-agent-marks'
import {
  WorkbenchListRow,
  WorkbenchListRowTrigger,
  WorkbenchListRowText,
  WorkbenchListRowMeta,
  WorkbenchListRowLeading,
} from '@localixai/kit/workbench-list-row'
import { Button } from '@localixai/kit/button'
import { formatRelativeTime } from '@localixai/plugin-sdk/ui/utilities'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import type { externalHistoryGroups } from '../model/historyGroups'
import { dragExternalResource, externalSessionUri } from '../model/sessionResource'

type Group = ReturnType<typeof externalHistoryGroups>[number]
type Agent = { id: string; name: string }
type Row =
  | { kind: 'day'; id: string; label: string }
  | { kind: 'agent'; id: string; provider: string; count: number }
  | { kind: 'session'; id: string; session: RosterRow }
  | { kind: 'more'; id: string }

function rowsOf(groups: Group[], collapsed: ReadonlySet<string>, hasMore: boolean): Row[] {
  const rows: Row[] = []
  for (const day of groups) {
    rows.push({ kind: 'day', id: day.id, label: day.label })
    for (const agent of day.agents) {
      const id = `${day.id}:${agent.id}`
      rows.push({ kind: 'agent', id, provider: agent.id, count: agent.sessions.length })
      if (!collapsed.has(id)) {
        rows.push(
          ...agent.sessions.map((session): Row => ({ kind: 'session', id: session.key, session })),
        )
      }
    }
  }
  if (hasMore) rows.push({ kind: 'more', id: 'more' })
  return rows
}

export function ExternalHistoryList({
  groups,
  agents,
  collapsed,
  opening,
  toggle,
  open,
  hasMore,
  loadingMore,
  loadMore,
}: {
  groups: Group[]
  agents: Agent[]
  collapsed: ReadonlySet<string>
  opening: string | null
  toggle: (id: string) => void
  open: (source: RosterRow) => void
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const rows = rowsOf(groups, collapsed, hasMore)
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => (rows[index]?.kind === 'day' ? 28 : 32),
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 8,
    initialRect: { width: 320, height: 640 },
  })
  return (
    <div
      ref={viewport}
      className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scrollbar-thin"
      aria-label="Agent sessions"
    >
      <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null
          let content
          if (row.kind === 'day') {
            content = (
              <p className="px-2 pb-1 pt-2 text-2xs font-medium text-text-faint">{row.label}</p>
            )
          } else if (row.kind === 'agent') {
            const expanded = !collapsed.has(row.id)
            const name =
              agents.find((provider) => provider.id === row.provider)?.name ?? row.provider
            const Mark =
              row.provider === 'claude-code'
                ? ClaudeMark
                : row.provider === 'codex'
                  ? CodexMark
                  : Bot
            content = (
              <WorkbenchListRow density="compact">
                <WorkbenchListRowTrigger aria-expanded={expanded} onClick={() => toggle(row.id)}>
                  <ChevronRight
                    aria-hidden="true"
                    className={`size-3 shrink-0 ${expanded ? 'rotate-90' : ''}`}
                  />
                  <WorkbenchListRowLeading>
                    <Mark className="size-3.5" />
                  </WorkbenchListRowLeading>
                  <WorkbenchListRowText title={name} />
                </WorkbenchListRowTrigger>
                <WorkbenchListRowMeta>{row.count}</WorkbenchListRowMeta>
              </WorkbenchListRow>
            )
          } else if (row.kind === 'session') {
            const session = row.session
            content = (
              <WorkbenchListRow density="compact" active={opening === session.key} className="pl-5">
                <WorkbenchListRowTrigger
                  title={session.title}
                  draggable
                  onDragStart={(event) =>
                    dragExternalResource(
                      event.dataTransfer,
                      externalSessionUri(session.key),
                      session.title,
                    )
                  }
                  disabled={opening !== null}
                  aria-busy={opening === session.key}
                  onClick={() => open(session)}
                >
                  <WorkbenchListRowText title={session.title || session.nativeSessionId} />
                </WorkbenchListRowTrigger>
                <WorkbenchListRowMeta title={new Date(session.updatedAt).toLocaleString()}>
                  {formatRelativeTime(session.updatedAt)}
                </WorkbenchListRowMeta>
              </WorkbenchListRow>
            )
          } else {
            content = (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? 'Loading…' : 'Show older sessions'}
              </Button>
            )
          }
          return (
            <div
              key={item.key}
              data-index={item.index}
              className="absolute left-0 top-0 w-full"
              style={{ height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
