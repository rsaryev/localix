/**
 * KUBERNETES resource provider — a `ResourceRefProvider` (agent-core resource-refs)
 * owning the `localix://resource/k8s` provider namespace. It is a sibling of the database / git /
 * container providers and turns the kubeconfig's contexts into a referenceable tree the
 * composer `@`-menu
 * drills and resolves a node to model-facing text, so a user can drag a pod / a
 * deployment / a service / a node (or its logs / describe / events / manifest) into
 * chat, or reach it via `@`.
 *
 * URI grammar (positional; context / namespace / name carry no `/`):
 *   localix://resource/k8s/<ctx>                              → a kube context (folder → namespaces + Nodes)
 *   localix://resource/k8s/<ctx>/<ns>                         → a namespace (folder → pods/deployments/services)
 *   localix://resource/k8s/<ctx>/<ns>/<pod>                   → a pod (folder → logs/describe/events/manifest)
 *   localix://resource/k8s/<ctx>/<ns>/<pod>/{logs,describe,events,manifest} → a pod leaf
 *   localix://resource/k8s/<ctx>/<ns>/<pod>/logs/container/<container>[/previous]
 *                                                     → the exact live log view
 *   localix://resource/k8s/<ctx>/<ns>/deployment/<name>       → a deployment (folder → describe/events/manifest)
 *   localix://resource/k8s/<ctx>/<ns>/service/<name>          → a service (folder → describe/events/manifest)
 *   localix://resource/k8s/<ctx>/<ns>/{deployment,service}/<name>/{describe,events,manifest} → a workload leaf
 *   localix://resource/k8s/<ctx>/node                         → the Nodes folder (cluster-scoped)
 *   localix://resource/k8s/<ctx>/node/<name>                  → a node (folder → describe/manifest)
 *   localix://resource/k8s/<ctx>/node/<name>/{describe,manifest} → a node leaf
 *
 * Pods use the 3-segment grammar (pod + logs/describe/events leaves); deployments/services
 * carry a `deployment`/`service` kind segment and nodes a `node` marker segment. The active context is carried IN
 * the URI (never mutating kubeconfig; each API client selects the requested context).
 * Introspection only; no secrets/kubeconfig contents cross the wire.
 *
 * The URI builders + section-node builders live in `resource-nodes.ts`, the drill-down
 * in `resource-list.ts`, and the leaf expansion in `resource-expand.ts` — this file
 * owns the service port + the provider shape.
 */
import type {
  KubeContext,
  KubeDeployment,
  KubeEvent,
  KubeManifest,
  KubeManifestKind,
  KubeNamespace,
  KubeNode,
  KubePod,
  KubeResourceKind,
  KubeService,
  PodDescribe,
  PodLogs,
  ResourceDescribe,
} from './contracts'
import type { ResourceRefProvider } from '@localixai/mini-app-sdk/backend'
import { failureNotice, PROVIDER } from './resource-nodes'
import { listResourceChildren } from './resource-list'
import { expandResource } from './resource-expand'
import { mapKubeError } from './errors'

/** Narrow structural port over `KubernetesService` — the only reads this provider needs. */
export interface ResourceKubernetesService {
  listContexts(): Promise<{ contexts: KubeContext[]; current: string }>
  listNamespaces(context?: string): Promise<KubeNamespace[]>
  listPods(namespace: string, context?: string): Promise<KubePod[]>
  getPod(namespace: string, name: string, context?: string): Promise<KubePod | null>
  listDeployments(namespace: string, context?: string): Promise<KubeDeployment[]>
  listServices(namespace: string, context?: string): Promise<KubeService[]>
  listNodes(context?: string): Promise<KubeNode[]>
  podLogs(
    namespace: string,
    pod: string,
    opts: { container?: string; tail: number; context?: string; previous?: boolean },
  ): Promise<PodLogs>
  describePod(namespace: string, pod: string, context?: string): Promise<PodDescribe>
  podEvents(namespace: string, pod: string, context?: string): Promise<KubeEvent[]>
  describeResource(
    kind: KubeResourceKind,
    namespace: string,
    name: string,
    context?: string,
  ): Promise<ResourceDescribe>
  resourceEvents(
    kind: KubeResourceKind,
    namespace: string,
    name: string,
    context?: string,
  ): Promise<KubeEvent[]>
  describeNode(name: string, context?: string): Promise<PodDescribe>
  getManifest(
    kind: KubeManifestKind,
    name: string,
    namespace: string | undefined,
    context?: string,
  ): Promise<KubeManifest>
}

export function createKubernetesResourceProvider(
  service: ResourceKubernetesService,
): ResourceRefProvider {
  return {
    provider: PROVIDER,
    title: 'Kubernetes',
    // ONE classification point for the whole tree. A cluster read that fails must never read
    // as an empty namespace or "(no describe output)" — the drill-down has no error channel, so
    // the failure rides in as a notice row; an expansion says so in its `error`.
    async listChildren(_userId, parentUri) {
      try {
        return await listResourceChildren(service, parentUri)
      } catch (err) {
        return [failureNotice(parentUri, err)]
      }
    },
    async expand(_userId, uri) {
      try {
        return await expandResource(service, uri)
      } catch (err) {
        return { ok: false, error: mapKubeError(err).friendly }
      }
    },
  }
}
