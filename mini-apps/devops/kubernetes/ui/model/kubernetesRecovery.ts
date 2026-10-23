import type { KubeIssue, KubernetesState } from './kubernetesState'

export type KubernetesRecoveryTarget = 'bootstrap' | 'resources'

const RECOVERY_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 15_000, 30_000] as const
export const KUBERNETES_AUTO_RETRY_LIMIT = 4

/** Remote clusters get a restrained retry cadence: responsive to short VPN/API
 *  flaps, then capped so a long outage remains inexpensive. */
export function kubernetesRecoveryDelay(attempt: number): number {
  return RECOVERY_DELAYS_MS[Math.min(Math.max(0, attempt), RECOVERY_DELAYS_MS.length - 1)]!
}

const TERMINAL_CODES = new Set([
  'no_kubeconfig',
  'authentication_failed',
  'permission_denied',
  'invalid_context',
  'certificate_error',
  'not_found',
  'port_forward_failed',
  'manifest_apply_failed',
])

/** Whether repeating the same read can recover without user configuration or
 *  credentials changing. Unknown transport/server failures remain retryable,
 *  while typed setup/auth/RBAC failures stay quiet until the user acts. */
export function isRetryableKubeIssue(issue: KubeIssue | null | undefined): boolean {
  if (!issue) return false
  if (issue.code && TERMINAL_CODES.has(issue.code)) return false
  return true
}

/** Decide which existing read path should recover the current state. Root scope
 *  failures rebuild context+namespace; partial collection failures only re-list
 *  resources so the current selection and last good snapshot stay intact. */
export function kubernetesRecoveryTarget(
  state: Pick<
    KubernetesState,
    'error' | 'resourceErrors' | 'unavailable' | 'unreachable' | 'activeNamespace'
  >,
): KubernetesRecoveryTarget | null {
  if (!state.unavailable && isRetryableKubeIssue(state.error)) return 'bootstrap'

  const hasRetryableCollection = Object.values(state.resourceErrors).some(isRetryableKubeIssue)
  if (!hasRetryableCollection) return null

  // A resource refresh requires a namespace. If namespace bootstrap did not
  // complete, rebuild that scope first; nodes will be re-listed with it.
  return state.activeNamespace ? 'resources' : 'bootstrap'
}

/** Whether this failure episode still has a quiet background attempt available. */
export function canAutoRetryKubernetes(attempts: number): boolean {
  return attempts < KUBERNETES_AUTO_RETRY_LIMIT
}

/**
 * Stable identity for one failure episode.
 *
 * Raw client detail is deliberately excluded: transports often add a request id,
 * address, or timestamp to every identical failure. Treating that as a new key
 * reset the attempt counter forever and was the source of the endless
 * "Reconnecting automatically…" loop.
 */
export function kubernetesRecoveryKey(
  state: Pick<KubernetesState, 'error' | 'resourceErrors'>,
): string {
  const rootIssue = state.error
  const root = rootIssue ? `root:${rootIssue.code ?? rootIssue.message}` : ''
  const collections = Object.entries(state.resourceErrors)
    .filter(([, issue]) => isRetryableKubeIssue(issue))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([collection, issue]) => {
      const value = issue!
      return `${collection}:${value.code ?? value.message}`
    })
    .join('|')
  return `${root}|${collections}`
}
