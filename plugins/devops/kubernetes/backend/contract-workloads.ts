/**
 * Workload shapes: deployment and service rows, the kinds that own a describe/events
 * tab, and that tab's describe payload.
 */

/** One API-derived deployment row. */
export interface KubeDeployment {
  name: string
  namespace: string
  /** `"2/3"` ready-replicas display. */
  ready: string
  upToDate: number
  available: number
  createdAt: string
}

/** One API-derived service row. */
export interface KubeService {
  name: string
  namespace: string
  type: string
  clusterIP: string
  /** Published ports display, e.g. `80/TCP,443/TCP`. */
  ports: string
  createdAt: string
}

/** A workload resource kind that has its own describe/events tab (deployment/service). */
export type KubeResourceKind = 'deployment' | 'service'

/** A deployment/service's identity header and canonical YAML as text. */
export interface ResourceDescribe {
  kind: KubeResourceKind
  name: string
  text: string
}
