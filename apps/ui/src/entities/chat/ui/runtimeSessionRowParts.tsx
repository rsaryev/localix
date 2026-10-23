import { memo } from 'react'
import { ChevronRight, Square } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Spinner } from '@localixai/kit/spinner'
import { StatusDot, STATUS_TONE_DOT } from '@localixai/kit/status-dot'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowMeta,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'
import { useSessionActivity } from '@localixai/mini-app-sdk/ui/session-activity'
import type { UiSession } from '@/shared/api/contracts'
import { runtimeCountsLabel, sessionTone, statusText, titleFor } from './runtimeSessionMeta'
import type { FlatNode } from './runtimeSessionTree'
import { TreeGuide } from './SessionTreeGuide'

interface RuntimeSessionRowProps {
  node: FlatNode
  isActive: boolean
  isStopping: boolean
  collapsed: boolean
  onToggle: (id: string) => void
  onSelect: (id: string) => void | Promise<void>
  onStop: (session: UiSession) => void
  /** A mini app status line's text for this row, drawn in place of its title and activity. */
  body?: string
}

/** Each row subscribes only to its own activity ticks. */
export const RuntimeSessionRow = memo(function RuntimeSessionRow({
  node,
  isActive,
  isStopping,
  collapsed,
  onToggle,
  onSelect,
  onStop,
  body,
}: RuntimeSessionRowProps) {
  const { session } = node
  const runtime = useSessionActivity(session.id)
  const isRunning = session.runtimeStatus === 'running'
  const countsLabel = isRunning ? runtimeCountsLabel(runtime) : undefined
  const title = titleFor(session)
  return (
    <WorkbenchListRow role="listitem" density="dense" active={isActive}>
      <TreeGuide prefixCols={node.prefixCols} depth={node.depth} isLast={node.isLast} />
      {node.childCount > 0 ? (
        <IconButton
          size="sm"
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title} sub-sessions`}
          aria-expanded={!collapsed}
          tooltip={`${node.childCount} ${node.childCount === 1 ? 'sub-session' : 'sub-sessions'}`}
          onClick={() => onToggle(session.id)}
        >
          <ChevronRight className={collapsed ? '' : 'rotate-90'} />
        </IconButton>
      ) : (
        <span aria-hidden className="size-(--chrome-control-sm) shrink-0" />
      )}
      <StatusDot className={STATUS_TONE_DOT[sessionTone(session)]} label={statusText(session)} />
      <WorkbenchListRowTrigger
        onClick={() => void onSelect(session.id)}
        aria-label={`Open ${title}`}
        aria-current={isActive ? 'page' : undefined}
        className="gap-3 px-0"
      >
        <span
          className={`min-w-0 flex-1 truncate text-xs text-left ${node.depth === 0 ? 'font-medium' : 'font-normal'}`}
        >
          {body || title}
        </span>
        {body ? null : isRunning && runtime.activity ? (
          <span className="max-w-40 truncate text-2xs text-text-faint" title={runtime.activity}>
            {runtime.activity}
          </span>
        ) : session.sessionKind === 'job' ? (
          <span className="shrink-0 text-2xs text-text-faint">job</span>
        ) : null}
      </WorkbenchListRowTrigger>
      {countsLabel && (
        <WorkbenchListRowMeta className="px-0 tabular-nums max-sm:hidden" title="Run activity">
          {countsLabel}
        </WorkbenchListRowMeta>
      )}
      {isRunning && (
        <WorkbenchListRowActions aria-label={`${title} actions`}>
          <IconButton
            size="md"
            tone="danger"
            disabled={isStopping}
            aria-label={`Stop ${title}`}
            tooltip={isStopping ? `Stopping ${title}…` : `Stop ${title}`}
            tooltipSide="top"
            onClick={() => onStop(session)}
            className="ring-1 ring-inset ring-control-border/55 hover:bg-status-error/12 hover:ring-status-error/25"
          >
            {isStopping ? (
              <Spinner size="xs" />
            ) : (
              <Square className="size-2.5" fill="currentColor" />
            )}
          </IconButton>
        </WorkbenchListRowActions>
      )}
    </WorkbenchListRow>
  )
})
