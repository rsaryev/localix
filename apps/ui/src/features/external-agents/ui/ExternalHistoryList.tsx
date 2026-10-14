import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { externalAgentPresentation } from '@/shared/ui/externalAgentPresentation'
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
import { externalHistoryRows, type HistoryGroup } from '../model/historyRows'
import type { SessionGroupingMode } from '@/features/chat/model/sessionGrouping'
import type { SortMode } from '@/features/chat/model/useSidebarSessions'
import { dragExternalResource, externalSessionUri } from '../model/sessionResource'

type Agent = { id: string; name: string }

export function ExternalHistoryList({
  groups,
  groupingMode,
  sortMode,
  agents,
  collapsed,
  opening,
  toggle,
  open,
  hasMore,
  loadingMore,
  loadMore,
}: {
  groups: HistoryGroup[]
  groupingMode: SessionGroupingMode
  sortMode: SortMode
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
  const rows = externalHistoryRows(groups, collapsed, hasMore, groupingMode, sortMode)
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
            const { Icon: Mark } = externalAgentPresentation(row.provider)
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
