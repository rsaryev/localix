/** A saved connection's row in the connections tree: dialect tint, name (or its inline rename),
 *  badges, status, and the hover actions — which share the row's single tab stop. */
import { Database, SquareTerminal } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { StatusDot } from '@localixai/kit/status-dot'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import { dbConnectionResourceUri } from '../../model/dbResourceUri'
import { DIALECT_META } from '../../model/dialects'
import type { ConnectionTreeRow } from '../../model/schemaTreeRows'
import { ConnectionBadges } from '../ConnectionBadge'
import { ConnectionActions } from '../explorer/ConnectionActions'
import type { RowViewProps } from './ObjectRows'
import { TreeChevron, TreeItem } from './TreeItem'
import { focusOnMount } from '../focusOnMount'

export function connectionStatus(connected: boolean, reconnecting: boolean): string {
  if (reconnecting) return 'Connecting'
  return connected ? 'Connected' : 'Disconnected'
}

export function ConnectionRowView({
  row,
  tabIndex,
  selected,
  actions,
}: RowViewProps<ConnectionTreeRow>) {
  const { connection } = row
  const displayName = connectionDisplayName(connection)
  const renaming = row.renameDraft !== null
  return (
    <TreeItem
      row={row}
      tabIndex={tabIndex}
      selected={selected}
      actions={actions}
      draggable={!renaming}
      onDragStart={(event) =>
        setMessageBindingDrag(
          event.dataTransfer,
          createMessageBindingDraft(
            'resource',
            dbConnectionResourceUri(connection.id),
            displayName,
          ),
        )
      }
    >
      <TreeChevron row={row} label={displayName} actions={actions} />
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm',
          DIALECT_META[connection.dialect].tint,
        )}
      >
        <Database className="size-3" />
      </span>
      {renaming ? (
        <Input
          value={row.renameDraft ?? ''}
          ref={focusOnMount}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => actions.renameChange?.(connection.id, event.target.value)}
          onBlur={() => actions.renameCommit?.()}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') actions.renameCommit?.()
            else if (event.key === 'Escape') actions.renameCancel?.()
          }}
          spellCheck={false}
          aria-label={`Rename ${displayName}`}
          // No fill override: Input already carries the `--input` veil, and `bg-surface-raised`
          // mixes from a darker ground than the sidebar, so the rename field read as a black slot.
          className="h-5 min-w-0 flex-1 rounded-sm border-control-border-focus px-1 text-xs"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-foreground">{displayName}</span>
      )}
      <ConnectionBadges readonly={connection.readonly} hasSsh={connection.hasSsh} />
      <StatusDot
        size="sm"
        className={connection.connected ? 'bg-status-success' : 'bg-text-faint'}
        label={connectionStatus(connection.connected, row.reconnecting)}
      />
      <IconButton
        size="xs"
        tabIndex={tabIndex}
        aria-label={`New query console for ${displayName}`}
        tooltip="New query console"
        className="lx-hover-actions shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(event) => {
          event.stopPropagation()
          actions.newConsole?.(connection.id)
        }}
      >
        <SquareTerminal className="size-3" />
      </IconButton>
      <span role="presentation" onClick={(event) => event.stopPropagation()}>
        <ConnectionActions
          displayName={displayName}
          entries={() => actions.menuFor(row) ?? []}
          compact
          tabIndex={tabIndex}
        />
      </span>
    </TreeItem>
  )
}
