import type { KubeContainerPort, KubePod, KubePortProbe, PodPhase } from './contracts'
import { itemsOf, num, parseJson, str } from './parse-core'
import { parseCpuNanos, parseMemoryBytes } from './metrics'

/**
 * Pure pod parsers for serialized Kubernetes API objects — the batch list, the
 * single-pod document, and shared per-item shaping reused by the informer.
 */

const PHASES: readonly PodPhase[] = ['Running', 'Pending', 'Succeeded', 'Failed', 'Unknown']

function normalizePhase(raw: unknown): PodPhase {
  const s = typeof raw === 'string' ? raw : ''
  return (PHASES as readonly string[]).includes(s) ? (s as PodPhase) : 'Unknown'
}

/** Extract a container's waiting/terminated reason, if unhealthy. */
function containerReason(cs: Record<string, unknown>): string {
  const state = (cs.state ?? {}) as Record<string, unknown>
  const waiting = (state.waiting ?? {}) as Record<string, unknown>
  const terminated = (state.terminated ?? {}) as Record<string, unknown>
  return str(waiting.reason) || str(terminated.reason)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function validPort(value: unknown): number | null {
  const port = num(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function probePort(
  container: Record<string, unknown>,
  probe: KubePortProbe,
  declared: readonly KubeContainerPort[],
): number | null {
  const definition = record(container[`${probe}Probe`])
  const transport = ['httpGet', 'tcpSocket', 'grpc']
    .map((key) => record(definition[key]))
    .find((candidate) => candidate.port !== undefined)
  const reference = transport?.port
  const numeric = validPort(reference)
  if (numeric !== null) return numeric
  if (typeof reference !== 'string') return null
  return declared.find((candidate) => candidate.name === reference)?.port ?? null
}

/**
 * Extract only TCP ports and retain the metadata that makes a default defensible.
 *
 * Non-TCP declarations are filtered and container/name/number retained. We additionally
 * resolve health-probe port references: `containerPort` is documentation, while a readiness or
 * liveness probe is expected to reach a real listener.
 */
function portForwardPorts(containers: readonly Record<string, unknown>[]): KubeContainerPort[] {
  const result: KubeContainerPort[] = []
  for (const container of containers) {
    const containerName = str(container.name)
    const declared: KubeContainerPort[] = []
    const ports = Array.isArray(container.ports)
      ? (container.ports as Record<string, unknown>[])
      : []
    for (const value of ports) {
      if (!value || typeof value !== 'object') continue
      const protocol = str(value.protocol).toUpperCase() || 'TCP'
      const port = validPort(value.containerPort)
      if (protocol !== 'TCP' || port === null) continue
      declared.push({
        container: containerName,
        name: str(value.name),
        port,
        protocol: 'TCP',
        probe: null,
      })
    }

    for (const probe of ['readiness', 'startup', 'liveness'] as const) {
      const port = probePort(container, probe, declared)
      if (port === null) continue
      const existing = declared.find((candidate) => candidate.port === port)
      if (existing) {
        if (existing.probe === null) existing.probe = probe
      } else {
        declared.push({
          container: containerName,
          name: '',
          port,
          protocol: 'TCP',
          probe,
        })
      }
    }

    for (const candidate of declared) {
      const existing = result.find((entry) => entry.port === candidate.port)
      if (!existing) {
        result.push(candidate)
      } else if (existing.probe === null && candidate.probe !== null) {
        existing.probe = candidate.probe
      }
    }
  }
  return result
}

/** Shape one pod object (a single `Pod` document, e.g. a `List` item OR a watch
 *  event's `object`) into a {@link KubePod} row. Shared by the batch
 *  {@link parsePods} and the streaming watch parser so their pod shaping can't drift. */
export function parsePodItem(it: Record<string, unknown>): KubePod {
  const meta = (it.metadata ?? {}) as Record<string, unknown>
  const spec = (it.spec ?? {}) as Record<string, unknown>
  const status = (it.status ?? {}) as Record<string, unknown>

  const specContainers = Array.isArray(spec.containers)
    ? (spec.containers as Record<string, unknown>[]).filter((c) => c && typeof c === 'object')
    : []
  const containers = specContainers.flatMap((container) => {
    const name = str(container.name)
    return name ? [name] : []
  })
  const initContainers: string[] = []
  if (Array.isArray(spec.initContainers)) {
    for (const candidate of spec.initContainers) {
      if (!candidate || typeof candidate !== 'object') continue
      const name = str((candidate as Record<string, unknown>).name)
      if (name) initContainers.push(name)
    }
  }

  const containerPorts = portForwardPorts(specContainers)

  // Scheduled RESERVATION, summed from `resources.requests` — a different question from
  // live usage and answerable without metrics-server, because it is just the pod spec.
  // A node at 15% measured CPU can still be 100% REQUESTED, which is why nothing new
  // schedules onto it; portainer shows reservation and usage side by side for this reason.
  // initContainers are excluded: they have exited, so the scheduler no longer holds them.
  const requested = specContainers.reduce<{ cpuNanos: number; memoryBytes: number }>(
    (total, container) => {
      const resources = (container.resources ?? {}) as Record<string, unknown>
      const requests = (resources.requests ?? {}) as Record<string, unknown>
      return {
        cpuNanos: total.cpuNanos + parseCpuNanos(requests.cpu),
        memoryBytes: total.memoryBytes + parseMemoryBytes(requests.memory),
      }
    },
    { cpuNanos: 0, memoryBytes: 0 },
  )

  const containerStatuses = Array.isArray(status.containerStatuses)
    ? (status.containerStatuses as Record<string, unknown>[]).filter(
        (c) => c && typeof c === 'object',
      )
    : []
  const totalCount = containerStatuses.length || containers.length
  const readyCount = containerStatuses.filter((cs) => cs.ready === true).length
  const restarts = containerStatuses.reduce((sum, cs) => sum + num(cs.restartCount), 0)

  // Surface the first unhealthy container reason (CrashLoopBackOff, ImagePullBackOff…),
  // falling back to a pod-level status reason.
  const reason = containerStatuses.map(containerReason).find(Boolean) || str(status.reason)

  return {
    uid: str(meta.uid),
    resourceVersion: str(meta.resourceVersion),
    name: str(meta.name),
    namespace: str(meta.namespace),
    phase: normalizePhase(status.phase),
    ready: `${readyCount}/${totalCount}`,
    readyCount,
    totalCount,
    restarts,
    node: str(spec.nodeName),
    podIP: str(status.podIP),
    createdAt: str(meta.creationTimestamp),
    containers,
    initContainers,
    containerPorts,
    requestedCpuNanos: requested.cpuNanos,
    requestedMemoryBytes: requested.memoryBytes,
    reason,
  }
}

/** Parse a serialized PodList into pod rows (ready/restarts/reason). */
export function parsePods(stdout: string): KubePod[] {
  return itemsOf(parseJson(stdout)).map(parsePodItem)
}

/** Parse a serialized Pod document into one {@link KubePod}, or
 *  `null` when the output is empty/invalid (e.g. the pod does not exist). */
export function parsePod(stdout: string): KubePod | null {
  const doc = parseJson(stdout)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const obj = doc as Record<string, unknown>
  if (str(obj.kind) && str(obj.kind) !== 'Pod') return null
  return parsePodItem(obj)
}
