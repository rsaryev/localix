/**
 * One saved request in the workspace navigator. Owned by this mini app — row components are not
 * shared, so each subsystem's row can say what its own domain needs.
 *
 * Management has two reachable surfaces over the same actions: a right-click context menu and a
 * kebab button revealed on hover/focus, so the menu is keyboard-reachable and not mouse-only. Both
 * offer Open / Open in new tab / Duplicate / Rename / Delete plus "Export as cURL". Rename swaps
 * the row's name for an input in place — Enter commits, Escape abandons — instead of routing
 * through a modal. Agent context is ambient for the active request; rows retain drag bindings for
 * intentionally attaching another request.
 *
 * The row is draggable into chat as its `localix://resource/api/…` ref: the same grammar the
 * backend's resource provider mints, imported from it rather than re-spelled here.
 */

import { useEffect, useRef, useState } from 'react'
import { KeyRound, MoreVertical } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { WorkbenchListRowTrigger } from '@localixai/kit/workbench-list-row'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { copyText } from '@localixai/mini-app-sdk/ui/interactions'
import { toast } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import type { RequestInfo } from '../../backend/contracts'
import { buildRequestUri } from '../../backend/uri'
import { REQUEST_MOVE_MIME } from '../model/moveRequest'
import { restApi } from '../restApi'
import { methodLabel, methodTone } from '../model/presentation'

/** Static classes so Tailwind sees every method tone at build time. */
const METHOD_TEXT: Record<ReturnType<typeof methodTone>, string> = {
  neutral: 'text-text-faint',
  accent: 'text-accent-foreground',
  info: 'text-status-info',
  warning: 'text-status-warning',
  error: 'text-status-error',
  success: 'text-status-success',
}

export function RequestRow({
  sessionId,
  request,
  displayName,
  busy,
  active,
  onOpen,
  onOpenInTab,
  onDelete,
  onDuplicate,
  onRename,
}: {
  /** The chat whose project holds the request — the workspace tab's session. */
  sessionId: string
  request: RequestInfo
  /** Leaf label inside a folder tree; actions still use request.name, the full stored path. */
  displayName?: string
  busy?: boolean
  /** Tint the row as the one the workspace's panes are currently showing. */
  active?: boolean
  /** Select it — the workspace's own panes move onto it. */
  onOpen: () => void
  /** Pop it OUT into its own editor-grid tab, for reading two responses side by side. */
  onOpenInTab: () => void
  onDelete: () => void
  onDuplicate: () => void
  /** Commit a rename; the caller surfaces a failure (e.g. name taken) via its own error state. */
  onRename: (to: string) => void
}) {
  const { name, spec } = request
  const visibleName = displayName ?? name
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) inputRef.current?.select()
  }, [renaming])

  const startRename = () => {
    setDraft(name)
    setRenaming(true)
  }

  const commit = () => {
    setRenaming(false)
    const to = draft.trim()
    if (to !== '' && to !== name) onRename(to)
    else setDraft(name)
  }

  const exportCurl = () => {
    void restApi
      .exportCurl(sessionId, name)
      .then((curl) => copyText(curl, 'cURL command'))
      .catch((cause: unknown) => {
        toast.error('Could not export cURL', {
          description: cause instanceof Error ? cause.message : undefined,
        })
      })
  }

  // The row's actions, described once. The right-click menu and the kebab dropdown are the same
  // menu reached two ways, and written twice they drifted immediately — the dropdown's Delete
  // carried the danger tint and the context menu's did not.
  const actions: MenuEntry[] = [
    { id: 'open', label: 'Open', onSelect: onOpen },
    { id: 'open-tab', label: 'Open in new tab', onSelect: onOpenInTab },
    { id: 'duplicate', label: 'Duplicate', onSelect: onDuplicate },
    { id: 'rename', label: 'Rename', onSelect: startRename },
    { separator: true },
    { id: 'curl', label: 'Export as cURL', onSelect: exportCurl },
    { separator: true },
    { id: 'delete', label: 'Delete', danger: true, onSelect: onDelete },
  ]

  // The fixed-width method gutter, shared by both the resting and renaming layouts so the name and
  // the rename input left-align on the same edge.
  const methodBadge = (
    <span
      className={cn(
        'w-[34px] shrink-0 font-mono text-2xs font-medium uppercase',
        METHOD_TEXT[methodTone(spec.method)],
      )}
      title={spec.method}
    >
      {methodLabel(spec.method)}
    </span>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- an HTML5 drag source has no keyboard form; the open button and the actions menu inside are the keyboard path */}
        <div
          role="listitem"
          aria-current={active ? 'true' : undefined}
          className={cn(
            'group/row flex min-h-7 items-center gap-1.5 py-0.5 pr-1.5 pl-3 hover:bg-surface-hover',
            active && 'bg-surface-active',
            busy && 'opacity-50',
          )}
          draggable={!renaming}
          onDragStart={(e) => {
            // TWO payloads on one drag, because a row has two destinations. The composer reads
            // the binding and references the request; the tree reads the move and re-files it.
            // HTML5 drag data is a set of MIME types, so neither destination sees the other's.
            setMessageBindingDrag(
              e.dataTransfer,
              createMessageBindingDraft('resource', buildRequestUri(name), name),
            )
            e.dataTransfer.setData(REQUEST_MOVE_MIME, name)
          }}
          title="Drag into chat to reference it, or onto a folder to move it"
        >
          {renaming ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {methodBadge}
              <Input
                ref={inputRef}
                size="md"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') {
                    setDraft(name)
                    setRenaming(false)
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Rename ${name}`}
                className="h-6 flex-1"
              />
            </div>
          ) : (
            <WorkbenchListRowTrigger
              type="button"
              onClick={onOpen}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              title={`${name}\n${spec.method} ${spec.url}`}
            >
              {methodBadge}
              <span className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground">
                {visibleName}
              </span>
            </WorkbenchListRowTrigger>
          )}

          {spec.auth.type !== 'none' && (
            <span
              role="img"
              aria-label={`Authenticated: ${spec.auth.type}`}
              title={`Authenticated: ${spec.auth.type}`}
              className="shrink-0 text-text-faint"
            >
              <KeyRound className="size-3" />
            </span>
          )}

          <div className="flex shrink-0 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  size="sm"
                  aria-label="Request actions"
                  className="lx-hover-actions opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreVertical className="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <MenuEntries entries={actions} family="dropdown" />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={actions} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
