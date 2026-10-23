import { Boxes, Layers, Server, Network, CalendarClock } from 'lucide-react'

import { resourceMessageBindingDraft, type MiniAppUiHost } from '@localixai/mini-app-sdk/ui'
import { buildK8sNodeUri, buildK8sPodUri, buildK8sWorkloadUri } from './model/resourceLink'
import { resolveKubernetesAnchor } from './register/anchor'
import { KubernetesPodBody, KubernetesResourceBody } from './register/bodies'

/**
 * UI registration for the bundled Kubernetes subsystem: two editor-grid WorkItem
 * kinds (pod + node/deployment/service), the search scope, and the resource anchors.
 *
 * The body adapters live in `register/bodies.tsx` and URI activation in
 * `register/anchor.ts`, so this file reads as the contribution list it is.
 *
 * The provider intentionally does not own a rail section: the root DevOps mini app
 * composes it with Docker behind the single DevOps Workspace entry.
 */
export function registerKubernetesContributions(host: MiniAppUiHost): void {
  host.workItems.register({
    kind: 'devops:kubernetes-pod',
    Component: KubernetesPodBody,
    Icon: Boxes,
    // Pods are ephemeral live objects. Do not issue seed/watch/log requests for a
    // stale context/namespace/name merely because the grid survived a reload.
    restorable: false,
    // A session kind: Exec opens a shell in the chat this tab belongs to.
    agentContext: {
      description: 'Live Kubernetes pod overview, logs, events, and metrics.',
      nextSteps: ['Inspect pod status and events.', 'Choose a container before reading its logs.'],
    },
    toMessageBinding: (item) => {
      const podName = item.payload?.podName
      const namespace = item.payload?.namespace
      if (typeof podName !== 'string' || typeof namespace !== 'string') return null
      const context =
        typeof item.payload?.context === 'string' && item.payload.context
          ? item.payload.context
          : 'current'
      return resourceMessageBindingDraft({
        uri: buildK8sPodUri({ context, namespace, name: podName }),
        label: item.title,
      })
    },
  })

  host.workItems.register({
    kind: 'devops:kubernetes-resource',
    Component: KubernetesResourceBody,
    Icon: Layers,
    // Deployments/services may be deleted or recreated between app launches.
    restorable: false,
    // A session kind: its related-pod rows open pod tabs in this tab's chat.
    agentContext: {
      description: 'Live Kubernetes resource details in the selected context and namespace.',
      nextSteps: [
        'Inspect the published resource state.',
        'Check related workloads, services, or events in the visible UI.',
      ],
    },
    toMessageBinding: (item) => {
      const kind = item.payload?.resourceKind
      const name = item.payload?.name
      const namespace = item.payload?.namespace
      if (typeof name !== 'string' || typeof namespace !== 'string') {
        return null
      }
      const context =
        typeof item.payload?.context === 'string' && item.payload.context
          ? item.payload.context
          : 'current'
      if (kind === 'node') {
        return resourceMessageBindingDraft({
          uri: buildK8sNodeUri({ context, name }),
          label: item.title,
        })
      }
      if (kind !== 'deployment' && kind !== 'service') return null
      return resourceMessageBindingDraft({
        uri: buildK8sWorkloadUri({ context, namespace, kind, name }),
        label: item.title,
      })
    },
  })

  // Global search: the Kubernetes result glyph(s) + how a `localix://resource/k8s/<ctx>/<ns>/<pod>`
  // hit opens its pod tab (`podTabWorkItemId` — the single tab-id source).
  host.search.register({
    id: 'devops:kubernetes-search',
    scope: {
      label: 'Kubernetes',
      prefix: 'k8s',
      aliases: ['kube', 'pod'],
      icon: 'k8s',
      lazy: true,
      placeholder: 'Search pods, deployments…',
    },
    icons: { k8s: Boxes, 'k8s-pod': Boxes },
  })
  host.anchors.register({
    id: 'devops:kubernetes-anchor',
    namespaces: ['k8s'],
    icons: {
      'k8s-context': Server,
      'k8s-namespace': Layers,
      'k8s-pod': Boxes,
      'k8s-deployment': Layers,
      'k8s-service': Network,
      'k8s-node': Server,
      events: CalendarClock,
    },
    resolve: resolveKubernetesAnchor,
  })
}
