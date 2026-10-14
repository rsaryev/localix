/**
 * The API-backed Kubernetes backend: one composition of four resource groups.
 *
 * The groups own their own resource (`api-cluster`, `api-pods`, `api-workloads`,
 * `api-manifests`) and share only the transport/shaping helpers in
 * `api-internals`. This file stays a table of contents so adding an operation
 * means touching one group, not one 600-line object.
 */
import type { KubernetesBackend } from './backend-port'
import { createClusterOperations } from './api-cluster'
import { createManifestOperations } from './api-manifests'
import { createPodOperations } from './api-pods'
import { createWorkloadOperations } from './api-workloads'

export function createKubernetesApiBackend(): KubernetesBackend {
  return {
    ...createClusterOperations(),
    ...createPodOperations(),
    ...createWorkloadOperations(),
    ...createManifestOperations(),
  }
}
