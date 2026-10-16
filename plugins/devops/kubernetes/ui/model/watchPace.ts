// Pure pacing + reconcile helpers for the Kubernetes pod feed. The PRIMARY live feed
// is the server-side API informer (see `podWatchClient.ts` / `backend/api-watch.ts`);
// the adaptive poll here is the FALLBACK when the
// watch is down: poll FAST while something is visibly changing (a pod is Pending /
// ContainerCreating / Terminating / crash-looping / not-yet-ready) and SLOW once the
// namespace settles. `applyPodWatch` reconciles one watch delta into the pod list.
// Pure + unit-tested so cadence + reconcile logic can't silently drift.
import type { KubePod, KubeWatchAction } from '../../backend/contracts'
import { podReasonKind } from './podReason'

/** Poll interval while a pod is in flux — snappy enough to feel live. */
export const FAST_POLL_MS = 2000
/** Poll interval once every pod is settled — light on a stable cluster. */
export const SLOW_POLL_MS = 8000

/** Is this pod mid-transition (worth polling fast for)? A pod that is Pending/Unknown,
 *  shows a transitional/backoff reason, or is Running-but-not-all-containers-ready. */
export function podInFlux(pod: KubePod): boolean {
  if (pod.phase === 'Pending' || pod.phase === 'Unknown') return true
  const kind = podReasonKind(pod.reason)
  if (kind === 'backoff' || kind === 'transitional') return true
  if (pod.phase === 'Running' && pod.readyCount < pod.totalCount) return true
  return false
}

/** The poll interval to use for the current pod list: fast while any pod is in flux,
 *  slow once the namespace is fully settled. */
export function pollIntervalFor(pods: KubePod[]): number {
  return pods.some(podInFlux) ? FAST_POLL_MS : SLOW_POLL_MS
}

function podIdentity(pod: KubePod): string {
  return pod.uid || `${pod.namespace}/${pod.name}`
}

function staleResourceVersion(current: string, incoming: string): boolean {
  if (!current || !incoming || current === incoming) return false
  if (/^\d+$/.test(current) && /^\d+$/.test(incoming)) {
    return BigInt(incoming) < BigInt(current)
  }
  return false
}

/** Apply one live watch delta to the current pod list, reconciling by Kubernetes
 *  UID (with namespace/name as a defensive fallback). Resource versions keep a
 *  late frame from rolling a row backwards. A MODIFIED for an unseen pod is
 *  treated as an ADD because a resumed watch may begin mid-stream. */
export function applyPodWatch(pods: KubePod[], action: KubeWatchAction, pod: KubePod): KubePod[] {
  const identity = podIdentity(pod)
  const idx = pods.findIndex((candidate) => podIdentity(candidate) === identity)
  if (action === 'DELETED') {
    if (idx === -1) return pods
    if (staleResourceVersion(pods[idx]!.resourceVersion, pod.resourceVersion)) return pods
    return pods.toSpliced(idx, 1)
  }
  if (idx === -1) return [...pods, pod]
  if (staleResourceVersion(pods[idx]!.resourceVersion, pod.resourceVersion)) return pods
  const next = pods.slice()
  next[idx] = pod
  return next
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function samePorts(a: KubePod['containerPorts'], b: KubePod['containerPorts']): boolean {
  return (
    a.length === b.length &&
    a.every((port, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        port.container === other.container &&
        port.name === other.name &&
        port.port === other.port &&
        port.protocol === other.protocol &&
        port.probe === other.probe
      )
    })
  )
}

function podEqual(a: KubePod, b: KubePod): boolean {
  return (
    a.uid === b.uid &&
    a.resourceVersion === b.resourceVersion &&
    a.name === b.name &&
    a.namespace === b.namespace &&
    a.phase === b.phase &&
    a.ready === b.ready &&
    a.readyCount === b.readyCount &&
    a.totalCount === b.totalCount &&
    a.restarts === b.restarts &&
    a.node === b.node &&
    a.podIP === b.podIP &&
    a.createdAt === b.createdAt &&
    a.reason === b.reason &&
    sameList(a.containers, b.containers) &&
    sameList(a.initContainers, b.initContainers) &&
    samePorts(a.containerPorts, b.containerPorts) &&
    a.requestedCpuNanos === b.requestedCpuNanos &&
    a.requestedMemoryBytes === b.requestedMemoryBytes
  )
}

/** Structural pod-list equality — used by the sidebar poll to keep the `pods` array
 *  REFERENCE-stable when a re-list returns identical content, so `useMemo`s keyed on
 *  it (and the rows below them) don't churn on every idle tick. Pure + unit-tested. */
export function podsEqual(a: KubePod[], b: KubePod[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((p, i) => {
    const q = b[i]
    return q !== undefined && podEqual(p, q)
  })
}

/** The grid WorkItem id for a pod's editor tab — the SINGLE source of the id formula,
 *  shared by `inspectorBusMapping` (open), the pod tab (its port-forward `owner`), and
 *  the tab-close cleanup hook, so the three can never drift out of agreement. */
export function podTabWorkItemId(
  context: string | undefined,
  namespace: string,
  podName: string,
): string {
  return `devops:kubernetes-pod:${context ?? ''}/${namespace}/${podName}`
}

/** The grid WorkItem id for a deployment/service resource tab — the SINGLE source of
 *  the id formula, shared by `inspectorBusMapping` (open) so re-opening focuses the
 *  existing tab rather than stacking duplicates. */
export function resourceTabWorkItemId(
  kind: 'deployment' | 'service',
  context: string | undefined,
  namespace: string,
  name: string,
): string {
  return `devops:kubernetes-resource:${kind}/${context ?? ''}/${namespace}/${name}`
}
