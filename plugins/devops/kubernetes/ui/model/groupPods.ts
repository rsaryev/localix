import type { KubePod, PodPhase } from '../../backend/contracts'
import { podReasonKind } from './podReason'

/** A pod's health bucket for sidebar grouping. */
export type PodHealth = 'healthy' | 'pending' | 'failed' | 'succeeded'

export interface PodGroup {
  key: PodHealth
  label: string
  pods: KubePod[]
}

const GROUP_ORDER: readonly PodHealth[] = ['failed', 'pending', 'healthy', 'succeeded']
const GROUP_LABELS: Record<PodHealth, string> = {
  failed: 'Unhealthy',
  pending: 'Pending',
  healthy: 'Running',
  succeeded: 'Completed',
}

/** A pod counts as unhealthy when it is failing OR has a bad container reason
 *  (CrashLoopBackOff, ImagePullBackOff…) even while nominally "Running". */
export function podHealth(pod: KubePod): PodHealth {
  const kind = podReasonKind(pod.reason)
  const badReason = kind === 'backoff' || kind === 'failed'
  if (pod.phase === 'Failed' || badReason) return 'failed'
  if (pod.phase === 'Pending' || pod.phase === 'Unknown') return 'pending'
  if (pod.phase === 'Succeeded') return 'succeeded'
  // Running but not all containers ready → still pending-ish.
  if (pod.phase === 'Running' && pod.totalCount > 0 && pod.readyCount < pod.totalCount)
    return 'pending'
  return 'healthy'
}

/** Group pods by health, in a stable severity-first order (failures on top). */
export function groupPods(pods: KubePod[]): PodGroup[] {
  const buckets = new Map<PodHealth, KubePod[]>()
  for (const pod of pods) {
    const h = podHealth(pod)
    const arr = buckets.get(h) ?? []
    arr.push(pod)
    buckets.set(h, arr)
  }
  const groups: PodGroup[] = []
  for (const key of GROUP_ORDER) {
    const arr = buckets.get(key)
    if (arr?.length) groups.push({ key, label: GROUP_LABELS[key], pods: arr })
  }
  return groups
}

/** Filter by a case-insensitive substring over the pod name (empty query → all). */
export function filterPods(pods: KubePod[], query: string): KubePod[] {
  const q = query.trim().toLowerCase()
  if (!q) return pods
  return pods.filter((p) => p.name.toLowerCase().includes(q))
}

/** Status dot class per phase/health (theme-aware status tokens, no bespoke colors). */
export function podDotClass(pod: KubePod): string {
  switch (podHealth(pod)) {
    case 'healthy':
      return 'bg-status-success'
    case 'pending':
      return 'bg-status-warning'
    case 'failed':
      return 'bg-status-error'
    case 'succeeded':
      return 'bg-status-info'
  }
  return 'bg-text-faint'
}

/** Compact relative age from an ISO creation timestamp (`3d`, `5h`, `12m`,
 *  `45s`). `now` is injectable for deterministic tests. */
/** Human phase label incl. an unhealthy reason when present. */
export function podStatusLabel(pod: PodPhaseCarrier): string {
  return pod.reason || pod.phase
}
interface PodPhaseCarrier {
  phase: PodPhase
  reason: string
}
