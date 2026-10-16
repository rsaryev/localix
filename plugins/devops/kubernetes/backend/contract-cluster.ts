/**
 * Cluster-scope shapes: the all-namespaces sentinel, kubeconfig contexts, and
 * namespace rows. Reached through the `contracts.ts` barrel like every sibling.
 */

/** Stable client-side scope value that selects a cluster-wide namespaced-resource list. */
export const ALL_NAMESPACES = '__all__'

/** A kubeconfig context (a cluster + user + default namespace). */
export interface KubeContext {
  name: string
  cluster: string
  /** Default namespace for the context, if the kubeconfig pins one. */
  namespace: string
  /** True for the kubeconfig's current-context. */
  current: boolean
}

/** One API-derived namespace row. */
export interface KubeNamespace {
  name: string
  /** `Active` / `Terminating`. */
  phase: string
}
