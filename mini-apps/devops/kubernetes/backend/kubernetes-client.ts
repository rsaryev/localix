import type * as k8s from '@kubernetes/client-node'

export type KubernetesClient = typeof k8s

let clientPromise: Promise<KubernetesClient> | undefined

/** Load the official client once, including when several Kubernetes paths activate concurrently. */
export function getKubernetesClient(): Promise<KubernetesClient> {
  return (clientPromise ??= import('@kubernetes/client-node'))
}
