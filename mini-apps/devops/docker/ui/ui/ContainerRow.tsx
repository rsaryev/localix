import { memo } from 'react'
import { Play, Square, RotateCw, Trash2, Container as ContainerIcon } from 'lucide-react'
import type { DockerContainer } from '../../backend/contracts'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { StatusDot } from '@localixai/kit/status-dot'
import { ResourceDragRow } from '../../../ui/ResourceDragRow'
import { stateDotClass } from '../model/groupContainers'
import { DOCKER_CONTAINER_GRID } from './DockerListHeader'
import { dockerContainerUri } from '../model/openTab'

/** What a container row can ask for. Each handler takes the container, so a list
 *  needs ONE stable handler per action instead of one closure per row — which is what
 *  makes the memo below actually skip unchanged rows. */
export interface ContainerRowActions {
  onOpen: (container: DockerContainer) => void
  onStart: (container: DockerContainer) => void
  onStop: (container: DockerContainer) => void
  onRestart: (container: DockerContainer) => void
  onRemoveRequest: (container: DockerContainer) => void
  onRemoveCancel: () => void
  onRemoveConfirm: (container: DockerContainer) => void
}

function ContainerRowView({
  container,
  showService,
  busy,
  confirmingRemove,
  actions,
}: {
  container: DockerContainer
  showService?: boolean
  busy: boolean
  confirmingRemove: boolean
  actions: ContainerRowActions
}) {
  const running = container.state === 'running' || container.state === 'restarting'
  const primary = showService && container.service ? container.service : container.name
  const resourceUri = dockerContainerUri(container.id)
  // The hover cluster's actions, also on right-click. The icons only appear on hover and sit in a
  // column that narrow layouts squeeze, so the menu is the reliable way to reach them.
  const menu: MenuEntry[] = [
    {
      id: 'open',
      label: 'Open container details',
      icon: ContainerIcon,
      onSelect: () => actions.onOpen(container),
    },
    { separator: true },
    ...(running
      ? ([
          {
            id: 'stop',
            label: 'Stop',
            icon: Square,
            disabled: busy,
            onSelect: () => actions.onStop(container),
          },
          {
            id: 'restart',
            label: 'Restart',
            icon: RotateCw,
            disabled: busy,
            onSelect: () => actions.onRestart(container),
          },
        ] satisfies MenuEntry[])
      : ([
          {
            id: 'start',
            label: 'Start',
            icon: Play,
            disabled: busy,
            onSelect: () => actions.onStart(container),
          },
        ] satisfies MenuEntry[])),
    { separator: true },
    {
      id: 'remove',
      // Naming the consequence, exactly as the inline confirm does: removing a running container
      // kills it, and a menu row that just says "Remove" hides that.
      label: running ? 'Force-remove (kill)…' : 'Remove…',
      icon: Trash2,
      danger: true,
      disabled: busy,
      onSelect: () => actions.onRemoveRequest(container),
    },
  ]
  const row = (
    <ResourceDragRow
      uri={resourceUri}
      label={container.name}
      onOpen={() => actions.onOpen(container)}
      className={cn(
        // While confirming, the metadata columns are replaced by the confirm cluster;
        // an auto track keeps its buttons whole instead of clipping them inside the
        // fixed-width action column.
        confirmingRemove
          ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2'
          : DOCKER_CONTAINER_GRID,
        'group/row py-1.5 pr-3 hover:bg-surface-hover',
        showService ? 'pl-6' : 'pl-3',
      )}
    >
      <button
        type="button"
        data-resource-drag-surface
        onClick={() => actions.onOpen(container)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-ring"
        title={`${container.image}\n${container.status}\nOpen container details`}
      >
        <StatusDot size="md" className={stateDotClass(container.state)} />
        <ContainerIcon className="size-3.5 shrink-0 text-text-faint" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs text-sidebar-foreground">{primary}</span>
          <span className={cn('truncate text-2xs text-text-faint', !showService && '@xl:hidden')}>
            {showService && container.service ? container.name : container.status}
          </span>
        </span>
      </button>

      {!confirmingRemove && (
        <>
          <span className="hidden truncate text-2xs text-text-soft @md:block">
            {container.image}
          </span>
          <span className="hidden truncate text-2xs text-text-faint @xl:block">
            {container.status}
          </span>
          <span
            className="hidden truncate text-2xs text-text-faint @3xl:block"
            title={container.ports || 'No published ports'}
          >
            {container.ports || '—'}
          </span>
        </>
      )}
      {confirmingRemove ? (
        <span className="flex items-center justify-end gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => actions.onRemoveConfirm(container)}
            disabled={busy}
            title={
              running
                ? 'Force-remove: the running container is killed (docker rm -f).'
                : 'Remove this stopped container.'
            }
            className="rounded-sm px-1.5 py-0.5 text-2xs text-status-error hover:bg-status-error/10"
          >
            {running ? 'Force-remove (kill)' : 'Remove'}
          </button>
          <button
            type="button"
            onClick={actions.onRemoveCancel}
            className="rounded-sm px-1.5 py-0.5 text-2xs text-text-faint hover:bg-surface-hover"
          >
            Cancel
          </button>
        </span>
      ) : (
        <span
          data-resource-column="action"
          className="lx-hover-actions flex min-w-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
        >
          {running ? (
            <>
              <IconButton
                size="xs"
                aria-label="Stop"
                tooltip="Stop"
                disabled={busy}
                onClick={() => actions.onStop(container)}
              >
                <Square className="size-3" />
              </IconButton>
              <IconButton
                size="xs"
                aria-label="Restart"
                tooltip="Restart"
                disabled={busy}
                onClick={() => actions.onRestart(container)}
              >
                <RotateCw className="size-3" />
              </IconButton>
            </>
          ) : (
            <IconButton
              size="xs"
              aria-label="Start"
              tooltip="Start"
              disabled={busy}
              onClick={() => actions.onStart(container)}
            >
              <Play className="size-3" />
            </IconButton>
          )}
          <IconButton
            size="xs"
            aria-label="Remove"
            tooltip="Remove"
            disabled={busy}
            onClick={() => actions.onRemoveRequest(container)}
          >
            <Trash2 className="size-3" />
          </IconButton>
        </span>
      )}
    </ResourceDragRow>
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * One container row. Memoized: the inventory reconciler keeps unchanged rows
 * identical across polls, so an unchanged row re-renders only when its own
 * callbacks or flags change.
 */
export const ContainerRow = memo(ContainerRowView)
