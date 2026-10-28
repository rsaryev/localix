import { useEffect, useState } from 'react'
import { Container, Gauge, Ship } from 'lucide-react'

import { RefreshAction } from '@localixai/kit/refresh-action'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { useElementVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { DockerSidebarView } from '../docker/ui/DockerSidebar'
import type { DockerResourceView } from '../docker/ui/model/dockerView'
import { useDocker } from '../docker/ui/model/useDocker'
import { KubernetesSidebarView } from '../kubernetes/ui/ui/KubernetesSidebar'
import { useKubernetes } from '../kubernetes/ui/model/useKubernetes'
import type { K8sResourceView } from '../kubernetes/ui/model/viewState'
import { DevOpsOverview } from './DevOpsOverview'
import { loadDevOpsArea, saveDevOpsArea, type DevOpsArea } from './model/devopsView'

const AREA_META: Array<{
  area: DevOpsArea
  label: string
  Icon: typeof Gauge
}> = [
  { area: 'overview', label: 'Overview', Icon: Gauge },
  { area: 'containers', label: 'Containers', Icon: Container },
  { area: 'kubernetes', label: 'Kubernetes', Icon: Ship },
]

/**
 * Full-width DevOps Workspace over both providers.
 *
 * Provider hooks live at this shell level so switching between Overview,
 * Containers, and Kubernetes preserves the latest inventory and watch lifecycle
 * instead of remounting and refetching each provider.
 */
export function DevOpsWorkspace({
  active = true,
  requestedArea,
  requestedDockerResource,
  requestedKubernetesResource,
}: {
  active?: boolean
  requestedArea?: DevOpsArea
  requestedDockerResource?: DockerResourceView
  requestedKubernetesResource?: K8sResourceView
}) {
  const [area, setAreaState] = useState<DevOpsArea>(() => requestedArea ?? loadDevOpsArea())
  // The shared grid keeps recent tabs mounted-but-hidden. Preserve this workspace's
  // state, but make its live providers inert until the body is actually visible.
  const [workspaceRef, workspaceVisible] = useElementVisible<HTMLDivElement>()
  const providersActive = active && workspaceVisible
  const docker = useDocker(4000, providersActive)
  const kubernetes = useKubernetes(providersActive)

  const setArea = (next: DevOpsArea) => {
    setAreaState(next)
    saveDevOpsArea(next)
  }

  // A new request for an area (a link, an `@`-ref) moves the workspace there. Decided while
  // rendering, when the request changes, so the old area never paints under the new request.
  const [seenRequestedArea, setSeenRequestedArea] = useState<DevOpsArea | undefined>(undefined)
  if (requestedArea !== seenRequestedArea) {
    setSeenRequestedArea(requestedArea)
    if (requestedArea) setAreaState(requestedArea)
  }
  useEffect(() => {
    if (requestedArea) saveDevOpsArea(requestedArea)
  }, [requestedArea])

  const refreshAll = () => {
    void docker.refresh()
    if (kubernetes.unavailable || kubernetes.unreachable || kubernetes.error) {
      kubernetes.retryBootstrap()
    } else {
      void kubernetes.refresh({ forceSecondary: true })
    }
  }
  const providersRefreshing =
    docker.loading || docker.refreshing || kubernetes.loading || kubernetes.refreshing

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div ref={workspaceRef} className="@container flex h-full min-h-0 flex-col">
      <WorkbenchToolbar as="header" aria-label="DevOps workspace sections">
        <SegmentedControl variant="muted" aria-label="DevOps Workspace sections">
          {AREA_META.map(({ area: candidate, label, Icon }) => (
            <SegmentedControlItem
              key={candidate}
              active={area === candidate}
              onClick={() => setArea(candidate)}
              title={label}
              className="min-w-0 px-2.5"
            >
              <Icon className="size-3" />
              <span className="truncate">{label}</span>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {area === 'overview' && (
          <RefreshAction
            size="sm"
            className="ml-auto"
            aria-label="Refresh all providers"
            tooltip="Refresh all providers"
            disabled={providersRefreshing}
            busy={providersRefreshing}
            onClick={refreshAll}
          />
        )}
      </WorkbenchToolbar>

      <div className="min-h-0 flex-1">
        {area === 'overview' ? (
          <DevOpsOverview docker={docker} kubernetes={kubernetes} onOpen={setArea} />
        ) : area === 'containers' ? (
          <DockerSidebarView docker={docker} requestedResource={requestedDockerResource} embedded />
        ) : (
          <KubernetesSidebarView
            kubernetes={kubernetes}
            requestedResource={requestedKubernetesResource}
            embedded
          />
        )}
      </div>
    </div>
  )
}
