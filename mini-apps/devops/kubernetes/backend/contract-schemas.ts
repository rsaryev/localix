import { z } from 'zod'
import type { Prerequisite } from '@localixai/mini-app-sdk/prerequisite'
import type {
  KubeApplyResult,
  KubeContext,
  KubeDeployment,
  KubeEvent,
  KubeManifest,
  KubeNamespace,
  KubeNode,
  KubePod,
  KubeService,
  NodeUsage,
  PodUsage,
  PortForward,
  ResourceDescribe,
} from './contract-types'

/** The workload kinds that get a per-resource describe/events tab. */
export const kubeResourceKindSchema = z.enum(['deployment', 'service'])

/** The kinds whose manifest can be viewed/edited as YAML (superset incl. pod + node). */
export const kubeManifestKindSchema = z.enum(['pod', 'deployment', 'service', 'node'])

/** Body for `POST /manifest/apply` — the full YAML to validate (server dry-run) then apply. */
export const applyManifestSchema = z.object({
  yaml: z.string().min(1),
})

/** Shared `?context=` selector — omitted ⇒ kubeconfig's current-context. */
export const contextQuerySchema = z.object({
  context: z.string().min(1).optional(),
})

/** `?context=&namespace=` for namespaced resource lists. */
export const namespaceQuerySchema = z.object({
  context: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
})

/**
 * `?context=&namespace=&kind=&limit=` for the generic any-kind list.
 *
 * `kind` is a free string, not an enum, on purpose: the set of kinds belongs to the CLUSTER (a CRD
 * installed a minute ago is as listable as `pods`), so validating against a union here would make
 * the endpoint blind to exactly what it exists to reach. Resolution happens against live API
 * discovery, and an unresolvable kind comes back as a typed 404.
 */
export const genericListQuerySchema = z.object({
  context: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  kind: z.string().min(1),
  /** Row cap; the response reports `truncated` when the server had more. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
})

export const podLogsQuerySchema = z.object({
  context: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  /** Fetch a single container's logs (else the pod's default/first container). */
  container: z.string().min(1).optional(),
  /** How many trailing log lines to fetch (default 500). */
  tail: z.coerce.number().int().min(1).max(10000).optional(),
  /** Overlapping incremental window used by the UI's bounded live-log buffer. */
  sinceSeconds: z.coerce.number().int().min(1).max(300).optional(),
  /** Fetch the PREVIOUS (last terminated) container's logs (`--previous`) — the way to
   *  see why a CrashLoopBackOff pod died. Query params arrive as STRINGS, and
   *  `Boolean('false') === true`, so `z.coerce.boolean()` would treat `?previous=false`
   *  as true — `z.stringbool()` parses the string form. */
  previous: z.stringbool().optional(),
  /** Interleave every container's logs (init containers included), each line prefixed with
   *  its source. Same string-boolean caveat as `previous`. */
  allContainers: z.stringbool().optional(),
})

export interface ContextsResponse {
  contexts: KubeContext[]
  current: string
}
export interface NamespacesResponse {
  namespaces: KubeNamespace[]
}
export interface PodsResponse {
  pods: KubePod[]
}
export interface DeploymentsResponse {
  deployments: KubeDeployment[]
}
export interface ServicesResponse {
  services: KubeService[]
}
export interface NodesResponse {
  nodes: KubeNode[]
}
export interface EventsResponse {
  events: KubeEvent[]
}
/**
 * Live pod usage, or `null` when the cluster serves no `metrics.k8s.io`.
 *
 * `null` is part of the contract, not an error channel: metrics-server is an optional
 * add-on, so "this cluster cannot tell you" is a normal answer that renders as blank
 * usage columns. A 503 here would take a healthy pod list down with a missing add-on.
 */
export interface PodMetricsResponse {
  pods: PodUsage[] | null
}
export interface NodeMetricsResponse {
  nodes: NodeUsage[] | null
}
export interface ResourceDescribeResponse {
  describe: ResourceDescribe
}
export interface ManifestResponse {
  manifest: KubeManifest
}
export interface ApplyManifestResponse {
  result: KubeApplyResult
}
export interface PortForwardsResponse {
  portForwards: PortForward[]
}
export interface PortForwardResponse {
  portForward: PortForward
}
export interface PodExecResponse {
  command: string
}

/** Optional container for a pods/exec session; pod/context/namespace stay in the route. */
export const podExecSchema = z.object({
  container: z.string().min(1).optional(),
})

/** Body for `POST /port-forwards` — start a managed Kubernetes API port-forward. */
export const startPortForwardSchema = z.object({
  context: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  pod: z.string().min(1),
  /** `0` asks the OS for a currently-free loopback port; the response carries the
   *  concrete assigned port. Explicit ports retain the traditional 1..65535 range. */
  localPort: z.coerce.number().int().min(0).max(65535),
  podPort: z.coerce.number().int().min(1).max(65535),
  /** Tag the forward with the transient surface (pod tab) that owns it, so it is
   *  torn down when that surface closes. Omitted ⇒ unowned (sidebar-started). */
  owner: z.string().min(1).optional(),
})

/** Body for `POST /port-forwards/stop-by-owner` — tear down every forward tagged
 *  with `owner` (the transient surface that started them just closed). */
export const stopForwardsByOwnerSchema = z.object({
  owner: z.string().min(1),
})

/** Body for `POST /deployments/:name/scale` — set a deployment's replica count. */
export const scaleDeploymentSchema = z.object({
  replicas: z.coerce.number().int().min(0).max(1000),
})

/** The typed error body every kubernetes route returns on failure. */
export interface KubeErrorResponse {
  error: string
  code: string
  detail?: string
  /** A stopped local engine or a missing credential helper — the UI offers Start / Install. */
  prerequisite?: Prerequisite
}
