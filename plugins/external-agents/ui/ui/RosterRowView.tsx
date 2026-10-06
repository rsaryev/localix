import { useRef, useState } from 'react'
import { ExternalLink, Import as ImportIcon } from 'lucide-react'
import { pluginNavigation, runPluginAction, type MenuEntry } from '@localixai/plugin-sdk/ui'
import { Chip } from '@localixai/kit/chip'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { Spinner } from '@localixai/kit/spinner'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { formatRelativeTime } from '@localixai/plugin-sdk/ui/utilities'
import { quietMinutes } from '../model/types'
import { isRowSelectClick, type PointerPoint } from '@localixai/plugin-sdk/ui/utilities'
import { middleEllipsis } from '../model/pathLabel'
import {
  importAndPrepareExternalAgentSession,
  openExternalAgentSession,
  sessionSourceOfRow,
  setSessionMessageBindingDrag,
} from '../model/openSession'
import { isLive } from '../model/stateTone'
import { AgentStateGlyph } from './AgentStateGlyph'
import type { ProviderId, RosterRow } from '../model/types'
import { AGENT_MARKS } from '../model/agentMarks'

/** Row height in px. Fixed, and shared with the virtualizer's `estimateSize` so measurement is
 *  exact and scroll position never drifts as rows recycle. */
export const ROSTER_ROW_HEIGHT = 46

/**
 * One roster row: a DRAG SOURCE for its session resource, and a click target that opens the
 * session's read-only transcript.
 *
 * Deliberately down to four things — mark, title, path, age — because a row is scanned, not read.
 * A link button was redundant with the drag the whole row already is; a state chip was worse than
 * redundant: almost every row is a session found on disk, whose "state" is the absence of an
 * observer, so the chip fired a popover to say nothing happened. State now appears only where
 * there IS something to say, as a dot on a live delegation.
 *
 * The press/drag/click arbitration is copied from plugins/devops/ui/ResourceDragRow.tsx rather than
 * re-derived: a native `draggable` parent would otherwise swallow a tap that moved a pixel.
 */
export function RosterRowView({ row, providerName }: { row: RosterRow; providerName: string }) {
  const sessionId = useWorkItemSessionId()
  const source = sessionSourceOfRow(row)
  const pointerDownRef = useRef<PointerPoint | null>(null)
  const draggedRef = useRef(false)
  const cwd = row.cwd ? middleEllipsis(row.cwd) : null
  const live = isLive(row)
  // Only a live delegation has a screen to have stopped moving; a historical row's stillness is not a
  // fact about an agent.
  const quiet = row.terminalId ? quietMinutes(row.lastChangeAt, Date.now()) : undefined
  const [importing, setImporting] = useState(false)
  const runImport = async () => {
    if (!source || importing) return
    setImporting(true)
    try {
      const imported = await importAndPrepareExternalAgentSession(source)
      pluginNavigation.revealSession(imported.id, imported.projectId)
    } finally {
      setImporting(false)
    }
  }

  // A transcript read that failed used to be an unhandled rejection: the click did nothing.
  // The transcript opens in the roster tab's own chat; a roster outside any chat offers no open.
  const open = () => {
    if (!source || !sessionId) return
    runPluginAction(
      () => openExternalAgentSession(sessionId, source),
      `Could not open “${source.title}”`,
    )
  }

  // The row opens the reader; import also remains available on hover or right-click.
  const rowMenu: MenuEntry[] = [
    {
      id: 'open',
      label: 'Open session',
      icon: ExternalLink,
      disabled: source == null || sessionId == null,
      onSelect: open,
    },
    {
      id: 'import',
      label: 'Import to Localix',
      icon: ImportIcon,
      disabled: source == null || importing,
      onSelect: () => runPluginAction(runImport, 'Could not import this conversation'),
    },
  ]

  const rowEl = (
    <div
      role="listitem"
      tabIndex={0}
      // A live delegation that has not correlated to a native session id yet has nothing on disk to
      // open or to refer to, so it is listed but neither draggable nor clickable.
      draggable={source != null}
      data-resource-uri={source?.uri}
      onPointerDown={(event) => {
        pointerDownRef.current = { x: event.clientX, y: event.clientY }
        draggedRef.current = false
      }}
      onDragStart={(event) => {
        if (!source) {
          event.preventDefault()
          return
        }
        draggedRef.current = true
        setSessionMessageBindingDrag(event.dataTransfer, source)
      }}
      onDragEnd={() => {
        pointerDownRef.current = null
        // Hold the drag marker through the browser's same-frame synthetic click; an ordinary click
        // begins with a fresh pointerdown, which clears it immediately.
        requestAnimationFrame(() => {
          draggedRef.current = false
        })
      }}
      onClick={(event) => {
        const shouldOpen = isRowSelectClick(
          pointerDownRef.current,
          { x: event.clientX, y: event.clientY },
          draggedRef.current,
        )
        pointerDownRef.current = null
        if (shouldOpen) open()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      className={cn(
        'group flex h-full min-w-0 select-none items-center gap-2.5 px-3 text-xs outline-none focus-ring hover:bg-surface-hover',
        source != null && 'cursor-pointer active:cursor-grabbing',
      )}
    >
      <ProviderMark provider={row.provider} name={providerName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-text-soft" title={row.title}>
          {row.title}
        </span>
        <span className="truncate text-2xs text-text-faint" title={row.cwd ?? row.sourcePath}>
          {cwd ?? row.sourcePath}
        </span>
      </div>
      {/* Only a delegation someone is actually watching carries a state. A row read off disk says
          nothing here rather than claiming `idle`, which would be a reading nobody took. */}
      {row.awaited === true && (
        // The reason the workspace looks idle: a turn stopped on purpose, waiting for this one.
        <Chip
          tone="info"
          size="dense"
          title="An agent is waiting on this session"
          className="shrink-0"
        >
          awaited
        </Chip>
      )}
      {live && (
        <AgentStateGlyph
          state={row.state}
          unconfirmed={row.stateFallback === true}
          authority={row.authority}
        />
      )}
      {source != null && (
        <IconButton
          size="sm"
          aria-label={`Import ${row.title} into Localix`}
          tooltip="Import as a Localix session"
          disabled={importing}
          onClick={(event) => {
            event.stopPropagation()
            runPluginAction(runImport, 'Could not import this conversation')
          }}
          className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {importing ? <Spinner size="sm" /> : <ImportIcon className="size-3.5" />}
        </IconButton>
      )}
      {/*
        Two different questions share this cell, so only one is shown at a time: when we last SAW the
        row, and — for a live delegation whose screen has stopped moving — how long it has been still.
        The second is the evidence an unconfirmed `idle` cannot give on its own, and it displaces the
        first because a reader watching a running agent is asking about the agent, not about us.
      */}
      {quiet === undefined ? (
        <span className="w-10 shrink-0 text-right text-2xs tabular-nums text-text-faint">
          {formatRelativeTime(row.updatedAt)}
        </span>
      ) : (
        <span
          className="w-10 shrink-0 text-right text-2xs tabular-nums text-status-warning"
          title={`The screen has not changed for ${quiet} minutes — it may have finished, or it may be stuck`}
        >
          {quiet}m still
        </span>
      )}
    </div>
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{rowEl}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={rowMenu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The agent's own mark. It replaces a text pill carrying the provider name: at 24 characters wide
 * that pill was the first thing on every row and the same word on most of them, while the glyph
 * says it in 14 pixels and leaves the title the widest thing in the list.
 */
function ProviderMark({ provider, name }: { provider: ProviderId; name: string }) {
  const Mark = AGENT_MARKS[provider]
  if (!Mark) {
    return (
      <span title={name} className="w-6 shrink-0 truncate text-2xs text-text-faint">
        {name.slice(0, 2)}
      </span>
    )
  }
  return (
    <span title={name} className="shrink-0 text-text-faint">
      <Mark className="size-3.5" />
    </span>
  )
}
