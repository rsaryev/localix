// REST client for the Kubernetes workbench backend (`/rpc/kubernetes`). A missing
// kubeconfig or unreachable cluster comes back as a typed
// stable KubeErrorCode with a 4xx/503 — we surface that so the sidebar can distinguish
// setup, authentication, and reachability failures instead of collapsing them into an
// error toast. The active context is chosen client-side and passed per-request as
// `?context=`, never mutating kubeconfig's current-context.
import { get, post, qs } from './transport'
import { DEVOPS_PORT_FORWARDS } from '../model/topics'
import type {
  ApplyManifestResponse,
  ContextsResponse,
  DeploymentsResponse,
  EventsResponse,
  KubeApiResources,
  KubeApplyResult,
  KubeContext,
  KubeDeployment,
  KubeEvent,
  KubeGenericList,
  KubeManifest,
  KubeManifestKind,
  KubeNamespace,
  KubeNode,
  KubePod,
  KubeResourceKind,
  KubeService,
  ManifestResponse,
  NamespacesResponse,
  NodeMetricsResponse,
  NodeUsage,
  NodesResponse,
  PodDescribe,
  PodLogs,
  PodMetricsResponse,
  PodUsage,
  PodsResponse,
  PortForward,
  PortForwardResponse,
  PortForwardsResponse,
  PodExecResponse,
  ResourceDescribe,
  ResourceDescribeResponse,
  ServicesResponse,
} from '../../backend/contracts'

const enc = encodeURIComponent

export const kubernetesApi = {
  async listContexts(): Promise<{ contexts: KubeContext[]; current: string }> {
    const body = await get<ContextsResponse>('/contexts')
    return { contexts: body.contexts, current: body.current }
  },
  async listNamespaces(context?: string): Promise<KubeNamespace[]> {
    return (await get<NamespacesResponse>(`/namespaces${qs({ context })}`)).namespaces
  },
  async listPods(namespace: string, context?: string): Promise<KubePod[]> {
    return (await get<PodsResponse>(`/pods${qs({ context, namespace })}`)).pods
  },
  async listDeployments(namespace: string, context?: string): Promise<KubeDeployment[]> {
    return (await get<DeploymentsResponse>(`/deployments${qs({ context, namespace })}`)).deployments
  },
  async listServices(namespace: string, context?: string): Promise<KubeService[]> {
    return (await get<ServicesResponse>(`/services${qs({ context, namespace })}`)).services
  },
  async listNodes(context?: string): Promise<KubeNode[]> {
    return (await get<NodesResponse>(`/nodes${qs({ context })}`)).nodes
  },
  /**
   * Live pod usage, or `null` when the cluster serves no `metrics.k8s.io`.
   *
   * `null` is an ANSWER, not a failure: callers render blank usage columns and must not
   * treat it as an error, because metrics-server is an optional cluster add-on.
   */
  async podMetrics(namespace: string, context?: string): Promise<PodUsage[] | null> {
    return (await get<PodMetricsResponse>(`/metrics/pods${qs({ context, namespace })}`)).pods
  },
  /** Live node usage. Same absent-metrics contract as {@link kubernetesApi.podMetrics}. */
  async nodeMetrics(context?: string): Promise<NodeUsage[] | null> {
    return (await get<NodeMetricsResponse>(`/metrics/nodes${qs({ context })}`)).nodes
  },
  /** Every resource kind the cluster serves, plus the API groups it could not reach. */
  async listApiResources(context?: string): Promise<KubeApiResources> {
    return get<KubeApiResources>(`/api-resources${qs({ context })}`)
  },
  /**
   * Objects of any kind, resolved server-side against live API discovery.
   *
   * An unknown kind arrives as a `not_found` {@link KubeApiError}, not an empty list — the caller has
   * to be able to tell "this cluster has no such kind" from "this kind has no objects".
   */
  async listByKind(
    kind: string,
    namespace: string,
    opts: { context?: string; limit?: number } = {},
  ): Promise<KubeGenericList> {
    return get<KubeGenericList>(
      `/objects${qs({ kind, namespace, context: opts.context, limit: opts.limit })}`,
    )
  },
  async cordonNode(name: string, context?: string): Promise<void> {
    await post<{ ok: true }>(`/nodes/${enc(name)}/cordon${qs({ context })}`)
  },
  async uncordonNode(name: string, context?: string): Promise<void> {
    await post<{ ok: true }>(`/nodes/${enc(name)}/uncordon${qs({ context })}`)
  },
  async drainNode(name: string, context?: string): Promise<void> {
    await post<{ ok: true }>(`/nodes/${enc(name)}/drain${qs({ context })}`)
  },
  /** Pods owned by a deployment (server resolves its selector). */
  async deploymentPods(name: string, namespace: string, context?: string): Promise<KubePod[]> {
    return (await get<PodsResponse>(`/deployments/${enc(name)}/pods${qs({ context, namespace })}`))
      .pods
  },
  async logs(
    name: string,
    opts: {
      namespace: string
      context?: string
      container?: string
      tail?: number
      sinceSeconds?: number
      previous?: boolean
      /** Interleave every container's logs, each line prefixed with its source. */
      allContainers?: boolean
    },
  ): Promise<PodLogs> {
    return get<PodLogs>(
      `/pods/${enc(name)}/logs${qs({
        context: opts.context,
        namespace: opts.namespace,
        container: opts.container,
        tail: opts.tail,
        sinceSeconds: opts.sinceSeconds,
        previous: opts.previous ? 'true' : undefined,
        allContainers: opts.allContainers ? 'true' : undefined,
      })}`,
    )
  },
  async describe(name: string, namespace: string, context?: string): Promise<PodDescribe> {
    return get<PodDescribe>(`/pods/${enc(name)}/describe${qs({ context, namespace })}`)
  },
  async execCommand(
    name: string,
    namespace: string,
    context?: string,
    container?: string,
  ): Promise<string> {
    return (
      await post<PodExecResponse>(`/pods/${enc(name)}/exec${qs({ context, namespace })}`, {
        container,
      })
    ).command
  },
  async deletePod(name: string, namespace: string, context?: string): Promise<void> {
    await post<{ ok: true }>(`/pods/${enc(name)}/delete${qs({ context, namespace })}`)
  },
  async events(name: string, namespace: string, context?: string): Promise<KubeEvent[]> {
    return (await get<EventsResponse>(`/pods/${enc(name)}/events${qs({ context, namespace })}`))
      .events
  },
  async describeResource(
    kind: KubeResourceKind,
    name: string,
    namespace: string,
    context?: string,
  ): Promise<ResourceDescribe> {
    return (
      await get<ResourceDescribeResponse>(
        `/resources/${kind}/${enc(name)}/describe${qs({ context, namespace })}`,
      )
    ).describe
  },
  async resourceEvents(
    kind: KubeResourceKind,
    name: string,
    namespace: string,
    context?: string,
  ): Promise<KubeEvent[]> {
    return (
      await get<EventsResponse>(
        `/resources/${kind}/${enc(name)}/events${qs({ context, namespace })}`,
      )
    ).events
  },
  /** A resource's live API object serialized as YAML. */
  async getManifest(
    kind: KubeManifestKind,
    name: string,
    namespace: string,
    context?: string,
  ): Promise<KubeManifest> {
    return (
      await get<ManifestResponse>(`/manifest/${kind}/${enc(name)}${qs({ context, namespace })}`)
    ).manifest
  },
  /** Validate (server dry-run) then apply an edited manifest. A rejection throws a
   *  `KubeApiError` with `code: 'manifest_apply_failed'` carrying the API message in
   *  `detail`, so the caller shows the validation error inline. */
  async applyManifest(yaml: string, context?: string): Promise<KubeApplyResult> {
    return (await post<ApplyManifestResponse>(`/manifest/apply${qs({ context })}`, { yaml })).result
  },
  async restartDeployment(name: string, namespace: string, context?: string): Promise<void> {
    await post<{ ok: true }>(`/deployments/${enc(name)}/restart${qs({ context, namespace })}`)
  },
  async scaleDeployment(
    name: string,
    namespace: string,
    replicas: number,
    context?: string,
  ): Promise<void> {
    await post<{ ok: true }>(`/deployments/${enc(name)}/scale${qs({ context, namespace })}`, {
      replicas,
    })
  },
  async listPortForwards(): Promise<PortForward[]> {
    return (await get<PortForwardsResponse>('/port-forwards')).portForwards
  },
  async startPortForward(input: {
    pod: string
    namespace: string
    localPort: number
    podPort: number
    context?: string
    /** Tag the forward with the transient surface (pod tab) that owns it. */
    owner?: string
  }): Promise<PortForward> {
    const started = (await post<PortForwardResponse>('/port-forwards', input)).portForward
    DEVOPS_PORT_FORWARDS.invalidate()
    return started
  },
  async stopPortForward(id: string): Promise<void> {
    await post<{ ok: true }>(`/port-forwards/${enc(id)}/stop`)
    DEVOPS_PORT_FORWARDS.invalidate()
  },
  /** Tear down every forward tagged with `owner` (its pod tab just closed). */
  async stopPortForwardsByOwner(owner: string): Promise<void> {
    await post<{ ok: true }>('/port-forwards/stop-by-owner', { owner })
    DEVOPS_PORT_FORWARDS.invalidate()
  },
}
