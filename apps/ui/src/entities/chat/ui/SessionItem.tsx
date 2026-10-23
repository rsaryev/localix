import { memo, useState, useCallback, useRef } from 'react'
import type { UiSession } from '@/shared/api/contracts'
import { sessionTitle } from './sessionTitle'
import { MessagesSquare, ChevronRight, GitFork, Bot } from 'lucide-react'
import { useChatStore } from '../model/store'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
  setElementDragImage,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { isRowSelectClick, type PointerPoint } from '@localixai/mini-app-sdk/ui/utilities'
import { SessionItemActions } from './SessionItemActions'
import { useSessionRowActions } from './useSessionRowActions'
import {
  SessionRowMeta,
  SESSION_ROW_HEIGHT_CLASS,
  SessionRowContent,
  SessionRowTimestamp,
} from './SessionRowContent'
import { Spinner } from '@localixai/kit/spinner'
import { sessionMenuEntries } from './sessionMenuEntries'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { CONTROL_FOCUS_VISIBLE } from '@localixai/mini-app-sdk/ui/classes'
import { TreeGuide } from './SessionTreeGuide'

// Tree indentation (px). Base matches the row's normal left padding; the step
// is small and the depth is capped so deep fork chains stay readable. See the
// guide-rail rendering in SessionItem.
const INDENT_BASE = 8
const INDENT_STEP = 20
const INDENT_MAX_DEPTH = 4
const EMPTY_TREE_PREFIX: readonly boolean[] = []

interface SessionItemProps {
  session: UiSession
  isActive: boolean
  onSelect: (
    session: UiSession,
    event?: React.MouseEvent | React.KeyboardEvent,
  ) => void | Promise<void>
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  /** Arrow-key roster traversal / extend (root chats only). `dir` −1 up / +1 down;
   *  `extend` true when Shift is held (grow the multi-select span). */
  onArrowNav?: (session: UiSession, dir: -1 | 1, extend: boolean) => void
  /** True when this row is part of a multi-select batch (⌘/Shift click). */
  selected?: boolean
  /** Tree depth — 0 for a top-level chat, >0 for a fork nested under its parent. */
  depth?: number
  treePrefixCols?: readonly boolean[]
  isLastChild?: boolean
  /** Total sub-sessions under this row (forks + threads + workers). Renders the
   *  left disclosure chevron when > 0; one click reveals/hides the whole subtree. */
  childCount?: number
  isExpanded?: boolean
  onToggleExpand?: (id: string) => void
}

export const SessionItem = memo(function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onTogglePin,
  onArrowNav,
  selected = false,
  depth = 0,
  treePrefixCols = EMPTY_TREE_PREFIX,
  isLastChild = true,
  childCount = 0,
  isExpanded = false,
  onToggleExpand,
}: SessionItemProps) {
  const title = sessionTitle(session)
  const toggleUnreadSession = useChatStore((s) => s.toggleUnreadSession)
  const toggleArchiveSession = useChatStore((s) => s.toggleArchiveSession)

  // A thread nests under the chat it belongs to — a plugin's activity log
  // (`system` session) or a message-anchored side-conversation (a chat keyed by
  // `message-thread:`). Mark both with a thread icon (not the fork glyph).
  const isThread =
    session.sessionKind === 'system' ||
    (session.sourceToolCallId?.startsWith('message-thread:') ?? false)
  const isWorker = session.sessionKind === 'subagent' || session.sessionKind === 'job'

  const {
    isRenaming,
    setIsRenaming,
    renameValue,
    setRenameValue,
    handleExport,
    handleSaveRename,
    handleCancelRename,
  } = useSessionRowActions(session, title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuBoundary, setMenuBoundary] = useState<HTMLElement | null>(null)

  // Indent via padding (not margin) so the row highlight still spans full width
  // like a tree row. The effective depth is capped so a long linear fork
  // chain stops marching right and the titles keep usable width; vertical guide
  // rails convey the nesting that the capped indent no longer fully shows.
  const effectiveDepth = Math.min(depth, INDENT_MAX_DEPTH)
  const padLeft = INDENT_BASE + effectiveDepth * INDENT_STEP

  // Click-vs-drag arbitration. The whole row is BOTH draggable (drag onto the
  // composer to link the chat) AND click-to-select. A native drag suppresses the
  // click, so selection is driven from a pointerdown→click gesture that only
  // counts as a select when no drag started and the pointer barely moved — this
  // makes a plain tap reliable even on a trackpad, where a stray pixel of jitter
  // used to arm a drag and swallow the switch. See {@link isRowSelectClick}.
  const pointerDownRef = useRef<PointerPoint | null>(null)
  const draggedRef = useRef(false)

  // Drag a session onto the composer to insert a `@session:<id>` context-ref
  // (a compact digest of this conversation). Suppressed while renaming so the
  // inline input's text selection still works.
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (isRenaming) return
      draggedRef.current = true
      e.dataTransfer.clearData()
      setMessageBindingDrag(
        e.dataTransfer,
        createMessageBindingDraft('session', session.id, session.title),
      )
      e.dataTransfer.effectAllowed = 'copy'
      setElementDragImage(e.dataTransfer, e.currentTarget, e)
    },
    [isRenaming, session.id, session.title],
  )

  // Whole-row click-to-select. Ignores clicks that originate from an interactive
  // control (the actions menu, pin/archive, the disclosure chevron, the rename
  // input) — each owns its own behaviour — and clicks that were really a drag.
  const handleRowClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isRenaming) return
      if ((e.target as HTMLElement).closest('button, input, a, [role="menuitem"]')) return
      const isClick = isRowSelectClick(
        pointerDownRef.current,
        { x: e.clientX, y: e.clientY },
        draggedRef.current,
      )
      pointerDownRef.current = null
      if (isClick) void onSelect(session, e)
    },
    [isRenaming, onSelect, session],
  )

  // One action list, two ways in: the hover kebab and a right-click anywhere on the row.
  const menuEntries = sessionMenuEntries(session, {
    onToggleUnread: toggleUnreadSession,
    onStartRename: () => setIsRenaming(true),
    onExport: () => void handleExport(),
    onExportRedacted: () => void handleExport(true),
    onTogglePin,
    onToggleArchive: () => void toggleArchiveSession(session.id),
    onDelete,
  })

  const row = (
    <div
      style={{ paddingLeft: padLeft }}
      onContextMenu={(event) => {
        setMenuBoundary(event.currentTarget.closest<HTMLElement>('[data-context-menu-boundary]'))
      }}
      draggable={!isRenaming}
      onDragStart={handleDragStart}
      onPointerDown={(e) => {
        pointerDownRef.current = { x: e.clientX, y: e.clientY }
        draggedRef.current = false
      }}
      onClick={handleRowClick}
      title={isRenaming ? undefined : 'Drag into the composer to link this conversation'}
      className={[
        'group group/workbench-row relative flex select-none items-center justify-between gap-1 overflow-hidden rounded-md pr-1 transition-colors',
        isRenaming ? '' : 'cursor-pointer',
        SESSION_ROW_HEIGHT_CLASS,
        selected
          ? 'bg-status-info/12 ring-1 ring-inset ring-status-info/40'
          : isActive
            ? 'bg-sidebar-accent/55'
            : 'hover:bg-sidebar-accent/35',
      ].join(' ')}
    >
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-0 w-0.5 rounded-full bg-status-info"
        />
      )}
      {effectiveDepth > 0 && (
        <span className="pointer-events-none absolute inset-y-0 left-1.5 flex">
          <TreeGuide
            depth={effectiveDepth}
            prefixCols={treePrefixCols.slice(0, effectiveDepth - 1)}
            isLast={isLastChild}
          />
        </span>
      )}
      {/* The disclosure column is RESERVED on every row, not only on the rows that have one.
          Rendering it conditionally pushed a parent's title half a chevron right of its
          childless siblings, so a row with sub-sessions read as nested under the row above
          it rather than beside it. */}
      {childCount > 0 ? (
        <button
          type="button"
          aria-label={isExpanded ? 'Collapse sub-sessions' : 'Expand sub-sessions'}
          aria-expanded={isExpanded}
          title={`${childCount} sub-session${childCount === 1 ? '' : 's'}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand?.(session.id)
          }}
          className="mr-0.5 flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-foreground/45 outline-none transition-colors hover:text-sidebar-foreground focus-ring"
        >
          <ChevronRight
            className={['size-3.5 transition-transform', isExpanded ? 'rotate-90' : ''].join(' ')}
          />
        </button>
      ) : (
        <span aria-hidden className="mr-0.5 size-4 shrink-0" />
      )}
      <div
        data-session-row={depth === 0 ? session.id : undefined}
        className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer"
        role="button"
        tabIndex={0}
        aria-label={title}
        aria-pressed={selected || undefined}
        aria-current={isActive ? 'true' : undefined}
        onKeyDown={(e) => {
          if (isRenaming) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void onSelect(session, e)
            return
          }
          // Arrow keys move roster focus (root chats only); Shift grows the
          // multi-select span from the anchor. Handled by the sidebar, which
          // owns the visual order and the selection.
          if (depth === 0 && onArrowNav && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            onArrowNav(session, e.key === 'ArrowDown' ? 1 : -1, e.shiftKey)
          }
        }}
      >
        {(depth > 0 || session.isRunning) && (
          <span
            data-slot="session-row-icon"
            className="flex size-4 shrink-0 items-center justify-center text-sidebar-foreground/50"
          >
            {session.isRunning ? (
              <Spinner className="size-3.5 text-status-info" aria-label="Working" />
            ) : isWorker ? (
              <Bot className="size-3.5 opacity-70" aria-label="Worker" />
            ) : !isThread ? (
              <GitFork className="size-3.5 -scale-x-100" aria-label="Fork" />
            ) : (
              <MessagesSquare className="size-3.5" aria-label="Thread" />
            )}
          </span>
        )}
        {isRenaming ? (
          <input
            type="text"
            aria-label="Rename session"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleSaveRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveRename()
              if (e.key === 'Escape') handleCancelRename()
            }}
            autoFocus
            className={`h-6 w-full rounded-md border border-sidebar-border bg-sidebar px-1.5 text-sm text-sidebar-foreground ${CONTROL_FOCUS_VISIBLE}`}
            onClick={(e) => e.stopPropagation()}
          />
        ) : depth === 0 ? (
          <SessionRowContent session={session} title={title} isActive={isActive} />
        ) : (
          <span
            className={[
              'min-w-0 truncate text-sm leading-5 transition-colors',
              isActive
                ? 'text-sidebar-foreground'
                : 'text-sidebar-foreground/75 group-hover:text-sidebar-foreground',
            ].join(' ')}
            title={title}
          >
            {title}
          </span>
        )}
      </div>

      {childCount > 0 && !isExpanded && (
        <span
          className="shrink-0 text-2xs tabular-nums text-text-faint"
          aria-label={`${childCount} ${childCount === 1 ? 'sub-session' : 'sub-sessions'}`}
        >
          {childCount}
        </span>
      )}
      <SessionRowMeta
        session={session}
        actions={
          <SessionItemActions
            menuOpen={menuOpen}
            onMenuOpenChange={setMenuOpen}
            entries={menuEntries}
            fallback={<SessionRowTimestamp session={session} />}
          />
        }
      />
    </div>
  )

  // While the row is renaming its inline input owns the pointer: the native menu over a text
  // field (copy/paste/spellcheck) is the right one there, and `nativeContextMenu` already
  // allows it. Wrapping would replace it with a menu whose Rename is the thing you are doing.
  if (isRenaming) return row
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      {/* A native WebView beside the sidebar paints above HTML. Constrain Radix collision
          placement to this pane so the menu shifts inward before reaching that layer. */}
      <ContextMenuContent collisionBoundary={menuBoundary ?? undefined} className="w-[190px]">
        <MenuEntries entries={menuEntries} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
})
