import { GripVertical, MoreHorizontal, Pencil, SlidersHorizontal, Trash2 } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ActivityOrb } from '@localixai/kit/activity-orb'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { Combobox, type ComboboxOption } from '@localixai/kit/combobox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import { StatusDot } from '@localixai/kit/status-dot'
import type { DbConnectionInfo } from '../../dbClient'
import { connectionBorderLeftClass } from '../../model/connectionColor'
import { DIALECT_LABEL } from '../../model/dialects'
import { ConnectionBadges } from '../ConnectionBadge'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import { dbConnectionResourceUri } from '../../model/dbResourceUri'
import type { RenameDraft } from './useDatabaseSidebar'
import { focusOnMount } from '../focusOnMount'

interface ConnectionPickerProps {
  connections: DbConnectionInfo[]
  selected: DbConnectionInfo | null
  reconnecting: Record<string, boolean>
  editing: RenameDraft | null
  setEditing: (next: RenameDraft | null) => void
  commitRename: () => void
  onPick: (connection: DbConnectionInfo) => void
  onEditConfig: (connection: DbConnectionInfo) => void
  onRemove: (id: string) => void
}

/** Compact connection switcher for the database sidebar. The full registry lives in a
 * searchable shared combobox, leaving the vertical space below to the selected schema. */
export function ConnectionPicker({
  connections,
  selected,
  reconnecting,
  editing,
  setEditing,
  commitRename,
  onPick,
  onEditConfig,
  onRemove,
}: ConnectionPickerProps) {
  const selectedIsRenaming = selected != null && editing?.id === selected.id
  const isConnecting = selected ? !!reconnecting[selected.id] : false
  const statusLabel = isConnecting
    ? 'Connecting'
    : selected?.connected
      ? 'Connected'
      : 'Disconnected'
  const options: ComboboxOption[] = connections.map((connection) => ({
    value: connection.id,
    label: connectionDisplayName(connection),
    hint: `${DIALECT_LABEL[connection.dialect]} · ${connection.connected ? 'Connected' : 'Offline'}`,
    icon: (
      <StatusDot
        size="md"
        className={cn(
          'ring-1 ring-inset',
          connection.connected
            ? 'bg-status-success ring-status-success/50'
            : 'bg-transparent ring-text-faint',
        )}
        label={connection.connected ? 'Connected' : 'Disconnected'}
      />
    ),
  }))

  return (
    <div
      className={cn(
        'shrink-0 border-b border-l-2 border-sidebar-border px-2 py-2',
        connectionBorderLeftClass(selected?.color) ?? 'border-l-transparent',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <span className="text-2xs font-medium text-text-faint">Connection</span>
        {selected && (
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-text-faint">
            {isConnecting ? (
              <ActivityOrb className="size-2.5 text-status-warning" />
            ) : (
              <StatusDot
                size="sm"
                className={selected.connected ? 'bg-status-success' : 'bg-text-faint'}
                label={statusLabel}
              />
            )}
            <span className="truncate">{statusLabel}</span>
            <ConnectionBadges readonly={selected.readonly} hasSsh={selected.hasSsh} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-1">
        {selected && (
          <span
            draggable={!selectedIsRenaming}
            onDragStart={(event) =>
              setMessageBindingDrag(
                event.dataTransfer,
                createMessageBindingDraft(
                  'resource',
                  dbConnectionResourceUri(selected.id),
                  selected.name,
                ),
              )
            }
            title="Drag into the composer to link this connection"
            className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-text-faint hover:bg-surface-hover hover:text-text-soft"
          >
            <GripVertical className="size-3" />
          </span>
        )}

        {selectedIsRenaming ? (
          <Input
            value={editing.draft}
            ref={focusOnMount}
            onChange={(event) => setEditing({ id: selected.id, draft: event.target.value })}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              else if (event.key === 'Escape') setEditing(null)
            }}
            spellCheck={false}
            aria-label="Rename connection"
            // No fill override: Input already carries the `--input` veil, and `bg-surface-raised`
            // mixes from a darker ground than the sidebar, so the rename field read as a black slot.
            className="h-7 min-w-0 flex-1 rounded-md border-control-border-focus px-2 text-xs"
          />
        ) : (
          <Combobox
            value={selected?.id ?? ''}
            onValueChange={(id) => {
              const connection = connections.find((item) => item.id === id)
              if (connection) onPick(connection)
            }}
            options={options}
            placeholder="Select a connection…"
            searchPlaceholder="Search connections…"
            emptyLabel="No matching connections"
            menuHeader={`${connections.length} ${connections.length === 1 ? 'connection' : 'connections'}`}
            size="md"
            aria-label="Active database connection"
            // No fill override: the Combobox trigger already carries the `--input` veil
            // (choice-trigger.ts), and `bg-surface-raised` mixes from a darker ground than the
            // sidebar — this was the black connection bar at the top of the database rail.
            className="min-w-0 flex-1 border-sidebar-border"
            contentClassName="max-w-[calc(100vw-2rem)]"
          />
        )}

        {selected && !selectedIsRenaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" tooltip="Connection actions" aria-label="Connection actions">
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                onSelect={() => setEditing({ id: selected.id, draft: selected.name })}
              >
                <Pencil className="size-3.5" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEditConfig(selected)}>
                <SlidersHorizontal className="size-3.5" />
                Edit connection…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRemove(selected.id)} tone="danger">
                <Trash2 className="size-3.5" />
                Delete connection…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
