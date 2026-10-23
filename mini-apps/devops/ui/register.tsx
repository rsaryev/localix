import { lazy, Suspense } from 'react'
import { Gauge } from 'lucide-react'

import type { MiniAppUiHost, WorkItemLike } from '@localixai/mini-app-sdk/ui'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import type { DockerResourceView } from '../docker/ui/model/dockerView'
import type { K8sResourceView } from '../kubernetes/ui/model/viewState'
import type { DevOpsArea } from './model/devopsView'
import { registerDockerContributions } from '../docker/ui/register'
import { registerKubernetesContributions } from '../kubernetes/ui/register'
import { useKubernetesForwardCleanup } from '../kubernetes/ui/model/useForwardCleanup'
import { useDevOpsForwardsStatusItem } from './statusItem'

const DevOpsWorkspaceLazy = lazy(() =>
  import('./DevOpsWorkspace').then((module) => ({ default: module.DevOpsWorkspace })),
)

/**
 * The workspace is a session kind. Its rows open container and pod tabs whose Exec shells into a
 * chat's terminal; as one global tab it opened them for whichever chat was on screen, so a click
 * in a workspace kept for chat A put the tab — and its shell — in chat B. It now acts for the chat
 * the host says it belongs to, and without one it has nowhere to open anything.
 */
function DevOpsWorkspaceBody({ item, visible }: { item: WorkItemLike; visible: boolean }) {
  const sessionId = useWorkItemSessionId()
  if (!sessionId) return <EmptyHint>Open the DevOps workspace from a chat.</EmptyHint>
  const area = item.payload?.area
  const dockerResource = item.payload?.dockerResource
  const kubernetesResource = item.payload?.kubernetesResource
  return (
    <Suspense fallback={<LoadingHint>Opening DevOps Workspace…</LoadingHint>}>
      <DevOpsWorkspaceLazy
        active={visible}
        requestedArea={
          area === 'overview' || area === 'containers' || area === 'kubernetes'
            ? (area as DevOpsArea)
            : undefined
        }
        requestedDockerResource={
          dockerResource === 'containers' ||
          dockerResource === 'images' ||
          dockerResource === 'volumes' ||
          dockerResource === 'networks'
            ? (dockerResource as DockerResourceView)
            : undefined
        }
        requestedKubernetesResource={
          kubernetesResource === 'pods' ||
          kubernetesResource === 'workloads' ||
          kubernetesResource === 'deployments' ||
          kubernetesResource === 'services' ||
          kubernetesResource === 'nodes' ||
          kubernetesResource === 'portForwards'
            ? (kubernetesResource as K8sResourceView)
            : undefined
        }
      />
    </Suspense>
  )
}

/** App-lifetime lifecycle: tear down a pod tab's managed port forwards on close. */
function DevOpsLifecycle() {
  useKubernetesForwardCleanup()
  return null
}

let registered = false

/** Register one extensible DevOps Workspace tab and both provider contribution sets. */
export function registerUi(host: MiniAppUiHost): void {
  if (registered) return
  registered = true

  registerDockerContributions(host)
  registerKubernetesContributions(host)

  host.workItems.register({
    kind: 'devops:workspace',
    Component: DevOpsWorkspaceBody,
    Icon: Gauge,
    restorable: true,
    agentContext: {
      description: 'Docker and Kubernetes inspection workspace.',
      nextSteps: [
        'Choose Docker or Kubernetes and inspect the visible live resources.',
        'Select a container, pod, or resource to publish its current state.',
        'Use the visible read-only controls; this mini app advertises no agent tools.',
      ],
    },
  })

  // Running port-forwards in the titlebar — a live tunnel is invisible once its surface closes.
  host.statusItems.register({
    id: 'devops:port-forwards',
    placement: 'titlebar',
    useItem: useDevOpsForwardsStatusItem,
  })

  host.railViewlets.register({
    kind: 'devops:workspace',
    title: 'DevOps',
    label: 'DevOps — containers & Kubernetes',
    // A full workspace belongs in the central grid. Keep its launcher with other
    // bundled mini app workbenches under `… → Mini apps`, not in the narrow primary rail.
    defaultArea: 'overflow',
    keywords: [
      'workspace',
      'operations',
      'devops',
      'docker',
      'containers',
      'images',
      'kubernetes',
      'k8s',
      'pods',
      'clusters',
      'logs',
    ],
    Icon: Gauge,
    Mount: DevOpsLifecycle,
  })
}
