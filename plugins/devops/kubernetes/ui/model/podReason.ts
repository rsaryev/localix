/**
 * One reading of a pod's surfaced container/pod `reason` (parse-pods keeps the first unhealthy
 * one), shared by the health grouping and the poll pacing so the two never disagree on it.
 *
 * - `backoff`: failing AND still changing — the kubelet keeps retrying.
 * - `failed`: a failure that is not being retried on its own.
 * - `transitional`: a normal lifecycle step on its way somewhere.
 */
export type PodReasonKind = 'backoff' | 'failed' | 'transitional'

const BACKOFF = /crashloopbackoff|imagepullbackoff|errimagepull/i
const FAILED = /error|oomkilled|containercannotrun|invalidimagename|evicted/i
const TRANSITIONAL = /containercreating|terminating|podinitializing|^init:/i

export function podReasonKind(reason: string | undefined): PodReasonKind | null {
  if (!reason) return null
  if (BACKOFF.test(reason)) return 'backoff'
  // `Init:Error` / `Init:CrashLoopBackOff` are failures first, init steps second.
  if (FAILED.test(reason)) return 'failed'
  if (TRANSITIONAL.test(reason)) return 'transitional'
  return null
}
