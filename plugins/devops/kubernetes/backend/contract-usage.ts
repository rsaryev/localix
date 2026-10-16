/** Live usage shapes from `metrics.k8s.io`, in base units (nanocores and bytes). */

/**
 * Live usage for one container, in BASE units — nanocores and bytes.
 *
 * Base units, not the display units, because `metrics.k8s.io` reports nanocores and
 * `Ki` and the formatting choice belongs to whichever surface renders it. Truncating to
 * millicores and megabytes at the API boundary makes a sub-millicore sidecar
 * permanently unrenderable as anything but `0`.
 */
export interface ContainerUsage {
  name: string
  cpuNanos: number
  memoryBytes: number
}

/** One pod's live usage: the sum of its containers, plus the per-container breakdown. */
export interface PodUsage {
  namespace: string
  name: string
  cpuNanos: number
  memoryBytes: number
  containers: ContainerUsage[]
}

/** One node's live usage. Nodes report a single usage block, so there is nothing to sum. */
export interface NodeUsage {
  name: string
  cpuNanos: number
  memoryBytes: number
}
