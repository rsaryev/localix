/** Node shapes: the cluster-scoped node row, including its schedulable capacity. */

/** One API-derived node row (status/roles/version at a glance). Nodes are
 *  cluster-scoped, so they carry no namespace. */
export interface KubeNode {
  name: string
  /** `Ready` when the node's Ready condition is `True`, else `NotReady`. */
  status: 'Ready' | 'NotReady'
  /** Roles from `node-role.kubernetes.io/<role>` labels (e.g. `control-plane`,
   *  `worker`); empty when the node advertises none. */
  roles: string[]
  /** Kubelet version, e.g. `v1.29.2`. */
  version: string
  /** False when the node is cordoned (`spec.unschedulable`). */
  schedulable: boolean
  createdAt: string
  /**
   * Schedulable CPU, in nanocores — the denominator for a node's usage percentage.
   *
   * `status.allocatable`, NOT `status.capacity`: capacity includes the slice reserved for
   * the kubelet and the OS, so a percentage against it silently understates pressure on a
   * node that is actually full: a gauge against capacity reads low by exactly the kubelet
   * and system reserve.
   * `0` when the node does not advertise it, which the UI must treat as "no percentage".
   */
  allocatableCpuNanos: number
  /** Schedulable memory, in bytes. Same allocatable-not-capacity reasoning. */
  allocatableMemoryBytes: number
}
