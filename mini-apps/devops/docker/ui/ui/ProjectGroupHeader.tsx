import { Play, Square, RotateCw, Layers } from 'lucide-react'
import type { ContainerGroup } from '../model/groupContainers'
import { isActive, stateDotClass } from '../model/groupContainers'
import type { DockerConfirm } from '../model/confirmCopy'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { StatusDot } from '@localixai/kit/status-dot'

/** A Compose project group's header row: aggregate status dot, project name + member
 *  count, and hover-revealed Up / Restart-all / Stop-all actions (each behind the
 *  sidebar's shared confirm dialog via `onConfirm`) — offered on right-click too, the way the
 *  container and resource rows under it already do. */
export function ProjectGroupHeader({
  group,
  composeAvailable,
  onConfirm,
}: {
  group: ContainerGroup
  composeAvailable: boolean
  onConfirm: (confirm: DockerConfirm) => void
}) {
  const ids = group.containers.map((container) => container.id)
  const menu: MenuEntry[] = [
    ...(composeAvailable && group.containers.some((container) => !isActive(container.state))
      ? ([
          {
            id: 'up',
            label: 'Up (docker compose up -d)',
            icon: Play,
            onSelect: () => onConfirm({ kind: 'compose-up', project: group.label }),
          },
        ] satisfies MenuEntry[])
      : []),
    {
      id: 'restart',
      label: 'Restart all services…',
      icon: RotateCw,
      onSelect: () => onConfirm({ kind: 'project', action: 'restart', project: group.label, ids }),
    },
    {
      id: 'stop',
      label: 'Stop all services…',
      icon: Square,
      onSelect: () => onConfirm({ kind: 'project', action: 'stop', project: group.label, ids }),
    },
  ]
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group/proj flex items-center gap-2 px-3 py-1">
          <StatusDot size="md" className={stateDotClass(group.state)} />
          <Layers className="size-3 shrink-0 text-text-faint" />
          <span
            className="min-w-0 flex-1 truncate text-2xs font-semibold text-sidebar-foreground"
            title={`Compose project ${group.label}`}
          >
            {group.label}
            <span className="ml-1.5 font-normal text-text-faint">· {group.containers.length}</span>
          </span>
          <span className="lx-hover-actions flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/proj:opacity-100 group-focus-within/proj:opacity-100">
            {composeAvailable && group.containers.some((c) => !isActive(c.state)) && (
              <IconButton
                size="xs"
                aria-label={`Bring up ${group.label}`}
                tooltip="Up (docker compose up -d)"
                onClick={() => onConfirm({ kind: 'compose-up', project: group.label })}
              >
                <Play className="size-3" />
              </IconButton>
            )}
            <IconButton
              size="xs"
              aria-label={`Restart all in ${group.label}`}
              tooltip="Restart all services"
              onClick={() =>
                onConfirm({
                  kind: 'project',
                  action: 'restart',
                  project: group.label,
                  ids: group.containers.map((c) => c.id),
                })
              }
            >
              <RotateCw className="size-3" />
            </IconButton>
            <IconButton
              size="xs"
              aria-label={`Stop all in ${group.label}`}
              tooltip="Stop all services"
              onClick={() =>
                onConfirm({
                  kind: 'project',
                  action: 'stop',
                  project: group.label,
                  ids: group.containers.map((c) => c.id),
                })
              }
            >
              <Square className="size-3" />
            </IconButton>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
