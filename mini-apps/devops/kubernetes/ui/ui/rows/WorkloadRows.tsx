import { Layers, Network as NetworkIcon, RotateCw, Scaling, Share2, Square } from 'lucide-react'
import type { KubeDeployment, KubeService, PortForward } from '../../../backend/contracts'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'

/**
 * The one wrapper these rows share: right-click reaches whatever the row's hover cluster does.
 *
 * Every row here reveals its actions on hover, and a touch pass has no hover while a keyboard pass
 * reaches them only after tabbing THROUGH the row — so on those two the actions may as well not
 * exist. A row whose menu would be empty keeps the native nothing rather than opening a blank
 * panel.
 */
function RowMenu({ menu, children }: { menu: MenuEntry[]; children: React.ReactNode }) {
  if (menu.length === 0) return <>{children}</>
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
import { ResourceDragRow } from '../../../../ui/ResourceDragRow'
import { formatResourceAge } from '../../../../ui/model/resourceAge'
import { KUBERNETES_RESOURCE_GRID } from '../KubernetesListHeader'
import { buildK8sPodUri, buildK8sWorkloadUri } from '../../model/resourceLink'

/** One deployment: ready-replicas count, draggable describe+events surface, and
 * hover-revealed Scale + Restart-rollout actions, also on the row's context menu. */
export function DeploymentRow({
  dep,
  context,
  showNamespace = false,
  onOpen,
  onScale,
  onRestart,
}: {
  dep: KubeDeployment
  context: string
  showNamespace?: boolean
  onOpen: () => void
  onScale: () => void
  onRestart: () => void
}) {
  const age = formatResourceAge(dep.createdAt)
  const resourceUri = context
    ? buildK8sWorkloadUri({
        context,
        namespace: dep.namespace,
        kind: 'deployment',
        name: dep.name,
      })
    : undefined
  return (
    <RowMenu
      menu={[
        { id: 'open', label: 'Open describe + events', icon: Layers, onSelect: onOpen },
        { separator: true },
        { id: 'scale', label: 'Scale replicas…', icon: Scaling, onSelect: onScale },
        { id: 'restart', label: 'Restart rollout…', icon: RotateCw, onSelect: onRestart },
      ]}
    >
      <ResourceDragRow
        uri={resourceUri}
        label={dep.name}
        onOpen={onOpen}
        className={cn(
          KUBERNETES_RESOURCE_GRID,
          'group/row px-3 py-1.5 text-xs text-text-soft hover:bg-surface-hover',
        )}
      >
        <button
          type="button"
          data-resource-drag-surface
          className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-ring"
          title={`${dep.name}\nOpen describe + events`}
          onClick={onOpen}
        >
          <Layers className="size-3 shrink-0 text-text-faint" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{dep.name}</span>
            {showNamespace && (
              <span className="truncate text-2xs text-text-faint">{dep.namespace}</span>
            )}
          </span>
        </button>
        <span
          data-resource-column="meta"
          className="truncate text-right tabular-nums text-2xs text-text-faint"
          title={`Ready ${dep.ready}${age ? ` · age ${age}` : ''}`}
        >
          {dep.ready}
          {age ? ` · ${age}` : ''}
        </span>
        <span
          data-resource-column="action"
          className="lx-hover-actions flex min-w-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
        >
          <IconButton size="xs" aria-label="Scale" tooltip="Scale replicas" onClick={onScale}>
            <Scaling className="size-3" />
          </IconButton>
          <IconButton
            size="xs"
            aria-label="Restart rollout"
            tooltip="Restart rollout"
            onClick={onRestart}
          >
            <RotateCw className="size-3" />
          </IconButton>
        </span>
      </ResourceDragRow>
    </RowMenu>
  )
}

/** One service: type + ports subtitle, cluster IP, and a draggable describe+events
 * surface. */
export function ServiceRow({
  svc,
  context,
  showNamespace = false,
  onOpen,
}: {
  svc: KubeService
  context: string
  showNamespace?: boolean
  onOpen: () => void
}) {
  const age = formatResourceAge(svc.createdAt)
  const resourceUri = context
    ? buildK8sWorkloadUri({
        context,
        namespace: svc.namespace,
        kind: 'service',
        name: svc.name,
      })
    : undefined
  return (
    <RowMenu
      menu={[{ id: 'open', label: 'Open describe + events', icon: NetworkIcon, onSelect: onOpen }]}
    >
      <ResourceDragRow
        uri={resourceUri}
        label={svc.name}
        onOpen={onOpen}
        className={cn(
          KUBERNETES_RESOURCE_GRID,
          'group/row px-3 py-1.5 text-xs text-text-soft hover:bg-surface-hover',
        )}
      >
        <button
          type="button"
          data-resource-drag-surface
          className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-ring"
          title={`${svc.name}\nOpen describe + events`}
          onClick={onOpen}
        >
          <NetworkIcon className="size-3 shrink-0 text-text-faint" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{svc.name}</span>
            <span className="truncate text-2xs text-text-faint">
              {showNamespace ? `${svc.namespace} · ` : ''}
              {svc.type}
              {svc.ports ? ` · ${svc.ports}` : ''}
            </span>
          </span>
        </button>
        <span
          data-resource-column="meta"
          className="truncate text-right text-2xs tabular-nums text-text-faint"
          title={`Cluster IP ${svc.clusterIP}${age ? ` · age ${age}` : ''}`}
        >
          {svc.clusterIP}
          {age ? ` · ${age}` : ''}
        </span>
        <span data-resource-column="action" aria-hidden="true" />
      </ResourceDragRow>
    </RowMenu>
  )
}

/** An active managed port-forward: `local → pod` on a linkable pod, with stop. */
export function PortForwardRow({
  pf,
  context,
  onOpen,
  onStop,
}: {
  pf: PortForward
  context?: string
  onOpen: () => void
  onStop: () => void
}) {
  const age = formatResourceAge(pf.createdAt)
  const resolvedContext = pf.context || context
  const resourceUri = resolvedContext
    ? buildK8sPodUri({ context: resolvedContext, namespace: pf.namespace, name: pf.pod })
    : undefined
  return (
    <RowMenu
      menu={[
        { id: 'open', label: 'Open pod details', icon: Share2, onSelect: onOpen },
        { separator: true },
        {
          id: 'stop',
          label: `Stop localhost:${pf.localPort} → ${pf.podPort}`,
          icon: Square,
          danger: true,
          onSelect: onStop,
        },
      ]}
    >
      <ResourceDragRow
        uri={resourceUri}
        label={pf.pod}
        onOpen={onOpen}
        className={cn(
          KUBERNETES_RESOURCE_GRID,
          'group/row px-3 py-1.5 text-xs text-text-soft hover:bg-surface-hover',
        )}
      >
        <button
          type="button"
          data-resource-drag-surface
          className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-ring"
          title={`${pf.pod}\n127.0.0.1:${pf.localPort} → ${pf.podPort}`}
          onClick={onOpen}
        >
          <Share2 className="size-3 shrink-0 text-status-success" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{pf.pod}</span>
            <span className="truncate text-2xs text-text-faint">{pf.namespace}</span>
          </span>
        </button>
        <span
          data-resource-column="meta"
          className="truncate text-right tabular-nums text-2xs text-text-faint"
          title={`localhost:${pf.localPort} → ${pf.pod}:${pf.podPort}${age ? ` · age ${age}` : ''}`}
        >
          {pf.localPort}→{pf.podPort}
          {age ? ` · ${age}` : ''}
        </span>
        <span data-resource-column="action" className="flex min-w-0 items-center justify-end">
          <IconButton
            size="xs"
            aria-label={`Stop localhost:${pf.localPort} → ${pf.pod}:${pf.podPort} forward`}
            tooltip={`Stop localhost:${pf.localPort} → ${pf.pod}:${pf.podPort}`}
            className="lx-hover-actions opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
            onClick={onStop}
          >
            <Square className="size-3" />
          </IconButton>
        </span>
      </ResourceDragRow>
    </RowMenu>
  )
}
