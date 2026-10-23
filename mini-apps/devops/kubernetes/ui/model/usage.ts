import type { KubeNode, KubePod, NodeUsage, PodUsage } from '../../backend/contracts'

/**
 * Pure display + pacing model for live usage (`metrics.k8s.io`).
 *
 * Kubernetes units, not the generic `KB/MB` formatter in the chat feature: a cluster
 * speaks `Ki/Mi/Gi` and millicores, so a node showing `15.7 GB` next to a manifest that
 * says `15707912Ki` reads as a different number. (That formatter is also another
 * feature's private module — a mini app must not reach into it.)
 *
 * Everything here stays pure and unit-tested, like `watchPace.ts`, because these are
 * the numbers a user makes scaling decisions from.
 */

/**
 * Poll cadence for usage.
 *
 * metrics-server scrapes every 15s by default, so a faster tick returns the same
 * numbers. The backend's own 10s cache
 * means several panels asking at once still cost one request.
 */
export const USAGE_POLL_MS = 10_000

/**
 * Cadence once the cluster has answered "no metrics API".
 *
 * A fixed 10s interval against a cluster that will keep answering 404 is ~8,600
 * pointless requests a day per open view. A cluster CAN gain metrics-server while the
 * workbench is open, so this retries — just at a cadence that matches how often that
 * actually happens.
 */
export const USAGE_ABSENT_RETRY_MS = 300_000

/** How long to wait before asking for usage again. */
export function usagePollDelay(available: boolean): number {
  return available ? USAGE_POLL_MS : USAGE_ABSENT_RETRY_MS
}

/** The join key between a usage row and a pod row. Namespace-qualified, so an
 *  all-namespaces list cannot match `default/api` against `staging/api`. */
export function podUsageKey(namespace: string, name: string): string {
  return `${namespace}/${name}`
}

/** Index usage rows for O(1) lookup from a pod row. */
export function indexPodUsage(rows: readonly PodUsage[] | null): Map<string, PodUsage> {
  return new Map((rows ?? []).map((row) => [podUsageKey(row.namespace, row.name), row]))
}

/** Index node usage rows by name. */
export function indexNodeUsage(rows: readonly NodeUsage[] | null): Map<string, NodeUsage> {
  return new Map((rows ?? []).map((row) => [row.name, row]))
}

/**
 * Nanocores → the millicore string a cluster is configured in.
 *
 * Sub-millicore usage keeps a decimal instead of collapsing to `0m`: idle sidecars
 * genuinely draw ~200µ, and truncating at the API boundary shows a column of zeros for
 * them, which reads as "not running".
 */
export function formatCpu(cpuNanos: number): string {
  if (!Number.isFinite(cpuNanos) || cpuNanos < 0) return ''
  const millicores = cpuNanos / 1e6
  if (millicores === 0) return '0m'
  if (millicores < 1) return `${millicores.toFixed(1)}m`
  if (millicores < 1000) return `${Math.round(millicores)}m`
  const cores = millicores / 1000
  return cores.toFixed(cores < 10 ? 2 : 1)
}

const MEMORY_UNITS = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'] as const

/** Bytes → `Ki`/`Mi`/`Gi`, the binary units every Kubernetes manifest uses. */
export function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < MEMORY_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  if (unit === 0) return `${Math.round(value)}B`
  return `${value < 10 ? value.toFixed(1) : Math.round(value)}${MEMORY_UNITS[unit]}`
}

/**
 * Usage as a percentage of what is schedulable, or `null` when there is no denominator.
 *
 * `null`, not `0`: a node that does not advertise `allocatable` is unknown, and drawing
 * an empty gauge for it claims the node is idle. Capped at 100 for display — a node
 * running slightly over its allocatable is real (system reserve is soft) but a `104%`
 * bar is a rendering bug to the eye.
 */
export function usagePercent(used: number, allocatable: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(allocatable) || allocatable <= 0) return null
  return Math.min(100, Math.max(0, (used / allocatable) * 100))
}

/** `23m (12%)`, or bare `23m` when there is no denominator to divide by. */
export function formatUsageShare(amount: string, percent: number | null): string {
  return percent === null ? amount : `${amount} (${Math.round(percent)}%)`
}

/** `12m · 64Mi`, the compact two-value usage label a row or header cell shows. */
export function formatUsagePair(cpuNanos: number, memoryBytes: number): string {
  return `${formatCpu(cpuNanos)} · ${formatMemory(memoryBytes)}`
}

/**
 * Per-container usage lines for a tooltip, widest consumer first.
 *
 * A pod row shows only the SUM, which hides the thing worth knowing on a multi-container
 * pod: whether the sidecar or the app is the one eating the limit. Sorted by CPU so the
 * answer is the first line.
 */
export function containerUsageLines(usage: PodUsage | undefined): string[] {
  return [...(usage?.containers ?? [])]
    .sort((a, b) => b.cpuNanos - a.cpuNanos)
    .map(
      (container) =>
        `${container.name} ${formatUsagePair(container.cpuNanos, container.memoryBytes)}`,
    )
}

export interface NodeUsageDisplay {
  cpu: string
  memory: string
  /** `null` when the node advertises no allocatable block. */
  cpuPercent: number | null
  memoryPercent: number | null
}

/**
 * The usage cell for one node row, or `null` when this node has no metrics.
 *
 * Percentages are computed against ALLOCATABLE (what the scheduler can hand out), not
 * capacity. Against capacity a full node reads as
 * comfortable by exactly the kubelet + system reserve.
 */
export function nodeUsageDisplay(
  node: Pick<KubeNode, 'allocatableCpuNanos' | 'allocatableMemoryBytes'>,
  usage: NodeUsage | undefined,
): NodeUsageDisplay | null {
  if (!usage) return null
  return {
    cpu: formatCpu(usage.cpuNanos),
    memory: formatMemory(usage.memoryBytes),
    cpuPercent: usagePercent(usage.cpuNanos, node.allocatableCpuNanos),
    memoryPercent: usagePercent(usage.memoryBytes, node.allocatableMemoryBytes),
  }
}

/**
 * What the scheduler has RESERVED on a node, from the requests of the pods placed there.
 *
 * The number that answers "why won't anything else schedule here": a node can sit at 15%
 * measured CPU while 100% of its allocatable is already requested. portainer shows
 * reservation and live usage side by side against the same allocatable limit; usage alone
 * cannot explain a Pending pod. Available with no metrics-server, since it is pod spec.
 */
export function nodeReservation(
  pods: readonly Pick<KubePod, 'requestedCpuNanos' | 'requestedMemoryBytes'>[],
  node: Pick<KubeNode, 'allocatableCpuNanos' | 'allocatableMemoryBytes'>,
): { cpu: string; memory: string; cpuPercent: number | null; memoryPercent: number | null } {
  const cpuNanos = pods.reduce((total, pod) => total + pod.requestedCpuNanos, 0)
  const memoryBytes = pods.reduce((total, pod) => total + pod.requestedMemoryBytes, 0)
  return {
    cpu: formatCpu(cpuNanos),
    memory: formatMemory(memoryBytes),
    cpuPercent: usagePercent(cpuNanos, node.allocatableCpuNanos),
    memoryPercent: usagePercent(memoryBytes, node.allocatableMemoryBytes),
  }
}
