import type {
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
  NodeUsage,
  PodDescribe,
  PodUsage,
  PodLogs,
  ResourceDescribe,
} from './contracts'

/**
 * Cluster-neutral Kubernetes backend port. The workbench talks to THIS interface
 * only; the runtime implementation talks to kube-apiserver through the official
 * JavaScript client. Another transport can drop in behind the same port with zero
 * service/route changes — the same port pattern the container workbench uses for its
 * engine backend.
 *
 * `context` is threaded through nearly every call and selected on a per-request
 * KubeConfig instance, never mutating the global kubeconfig current-context.
 */
export interface KubernetesBackend {
  listContexts(): Promise<{ contexts: KubeContext[]; current: string }>
  listNamespaces(context?: string): Promise<KubeNamespace[]>
  listPods(namespace: string, context?: string): Promise<KubePod[]>
  /** Fetch one pod directly — avoids an O(n) full-namespace
   *  fetch when only one pod's row is needed. `null` when the pod does not exist. */
  getPod(namespace: string, name: string, context?: string): Promise<KubePod | null>
  listDeployments(namespace: string, context?: string): Promise<KubeDeployment[]>
  listServices(namespace: string, context?: string): Promise<KubeService[]>
  /** Cluster-scoped node list. */
  listNodes(context?: string): Promise<KubeNode[]>
  /**
   * Live pod usage from `metrics.k8s.io`, or `null` when the cluster has no metrics API.
   *
   * `null` rather than a rejection: metrics-server is an optional add-on that a kind or bare
   * kubeadm cluster simply does not run, and a namespace-scoped user may be forbidden from reading
   * it. Either condition leaves the core pod data available, so callers can render usage as
   * unavailable without losing the pod list. `namespace` may be {@link ALL_NAMESPACES}.
   */
  podMetrics(namespace: string, context?: string): Promise<PodUsage[] | null>
  /** Live node usage. Same absent-metrics contract as {@link KubernetesBackend.podMetrics}. */
  nodeMetrics(context?: string): Promise<NodeUsage[] | null>
  /**
   * Every resource type the cluster serves, from API discovery — including CRDs.
   *
   * The five `list*` calls above cover the kinds with a bespoke UI. This pair
   * ({@link KubernetesBackend.listApiResources} + {@link KubernetesBackend.listByKind}) covers the
   * rest WITHOUT adding a method per kind: the transport was always generic
   * (`KubernetesObjectApi` addresses any object by apiVersion+kind, which is how `applyManifest`
   * has always worked), so the only thing the typed lists really added was knowing that
   * `certificates` means `cert-manager.io/v1 Certificate`. Discovery answers that.
   */
  listApiResources(context?: string): Promise<KubeApiResources>
  /**
   * List any kind by the word a user typed (plural, kind, singular or short name).
   *
   * `null` when discovery knows no such listable kind — a missing CRD is a normal answer, not an
   * error. `namespace` is ignored for cluster-scoped kinds and may be {@link ALL_NAMESPACES}.
   */
  listByKind(
    kind: string,
    namespace: string,
    opts?: { limit?: number; context?: string },
  ): Promise<KubeGenericList | null>
  /** Mark a node unschedulable through its spec. */
  cordonNode(name: string, context?: string): Promise<void>
  /** Mark a node schedulable again through its spec. */
  uncordonNode(name: string, context?: string): Promise<void>
  /** Cordon a node and evict eligible pods through policy/v1. */
  drainNode(name: string, context?: string): Promise<void>
  /** Pods owned by a deployment (filtered by its `spec.selector.matchLabels`). */
  listDeploymentPods(namespace: string, name: string, context?: string): Promise<KubePod[]>
  podLogs(
    namespace: string,
    pod: string,
    opts: {
      container?: string
      tail: number
      context?: string
      previous?: boolean
      sinceSeconds?: number
      /**
       * Fetch EVERY container (init containers included) and interleave them.
       *
       * `tail` then applies per container, exactly as `kubectl logs --all-containers
       * --tail=N` does — the API has no pod-wide tail, so a shared budget would mean
       * guessing how to divide it and silently truncating the chattiest container.
       * Ignored when `container` is set: naming one container is the more specific ask.
       */
      allContainers?: boolean
    },
  ): Promise<PodLogs>
  describePod(namespace: string, pod: string, context?: string): Promise<PodDescribe>
  deletePod(namespace: string, pod: string, context?: string): Promise<void>
  podEvents(namespace: string, pod: string, context?: string): Promise<KubeEvent[]>
  restartDeployment(namespace: string, name: string, context?: string): Promise<void>
  scaleDeployment(
    namespace: string,
    name: string,
    replicas: number,
    context?: string,
  ): Promise<void>
  /** A deployment/service diagnostic summary built from API objects. */
  describeResource(
    kind: KubeResourceKind,
    namespace: string,
    name: string,
    context?: string,
  ): Promise<ResourceDescribe>
  /** Events involving a deployment/service (`--field-selector involvedObject.*`). */
  resourceEvents(
    kind: KubeResourceKind,
    namespace: string,
    name: string,
    context?: string,
  ): Promise<KubeEvent[]>
  /** A resource's live manifest serialized as YAML. Namespace is
   *  ignored for cluster-scoped kinds (nodes). */
  getManifest(
    kind: KubeManifestKind,
    name: string,
    namespace: string | undefined,
    context?: string,
  ): Promise<KubeManifest>
  /** Validate with a server-side dry run, then apply with server-side apply.
   *  Validation failures surface as a typed `manifest_apply_failed`. */
  applyManifest(yaml: string, context?: string): Promise<KubeApplyResult>
  /** A cluster-scoped node diagnostic summary built from its API object. */
  describeNode(name: string, context?: string): Promise<PodDescribe>
}
