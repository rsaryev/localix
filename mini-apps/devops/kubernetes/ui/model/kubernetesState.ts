import type {
  KubeContext,
  KubeDeployment,
  KubeNamespace,
  KubeNode,
  KubePod,
  KubeService,
  PortForward,
} from '../../backend/contracts'
import { KubeApiError } from '../api/transport'
import type { DevOpsIssue } from '../../../ui/DevOpsProblem'

export type KubeCollection = 'pods' | 'deployments' | 'services' | 'nodes' | 'portForwards'

/** User-facing failure with the operator detail kept separately from the calm summary — the
 *  DevOps problem shape, so a stopped engine's Start action and the failed request reach it. */
export type KubeIssue = DevOpsIssue

/** The state shape `useKubernetes` drives the sidebar with. */
export interface KubernetesState {
  contexts: KubeContext[]
  /** The kubeconfig's current-context (used as the initial selection). */
  currentContext: string
  /** The client-selected active context (used to construct the request's API client). */
  activeContext: string
  namespaces: KubeNamespace[]
  activeNamespace: string
  pods: KubePod[]
  deployments: KubeDeployment[]
  services: KubeService[]
  /** Cluster-scoped nodes for the active context (not namespaced). */
  nodes: KubeNode[]
  /** Active managed API port forwards (process-global, not namespaced). */
  portForwards: PortForward[]
  loading: boolean
  /** True while a USER-VISIBLE refresh is in flight (drives the header spinner).
   *  Background poll ticks refresh silently — they never blip the spinner. */
  refreshing: boolean
  /** Set when kubeconfig is absent or invalid — the sidebar shows a setup hint. */
  unavailable: boolean
  /** Set when a context exists but the cluster is unreachable — a quiet retry hint. */
  unreachable: boolean
  /** True while a live informer is streaming for the active ctx+namespace
   *  (pods update instantly). False ⇒ the adaptive poll fallback is driving updates. */
  watchLive: boolean
  /** Fatal scope/bootstrap failure. Collection failures live beside their last good data. */
  error: KubeIssue | null
  /** Partial failures must not masquerade as empty collections. */
  resourceErrors: Partial<Record<KubeCollection, KubeIssue>>
  /** Epoch of the last successful resource response, used by the sync-status line. */
  lastUpdatedAt: number | null
}

export const initialKubernetesState: KubernetesState = {
  contexts: [],
  currentContext: '',
  activeContext: '',
  namespaces: [],
  activeNamespace: '',
  pods: [],
  deployments: [],
  services: [],
  nodes: [],
  portForwards: [],
  loading: true,
  refreshing: false,
  unavailable: false,
  unreachable: false,
  watchLive: false,
  error: null,
  resourceErrors: {},
  lastUpdatedAt: null,
}

export function toKubeIssue(err: unknown): KubeIssue {
  if (err instanceof KubeApiError) {
    return {
      code: err.code,
      message: err.message,
      detail: err.detail,
      ...(err.prerequisite ? { prerequisite: err.prerequisite } : {}),
      ...(err.request ? { request: err.request } : {}),
    }
  }
  return {
    message: err instanceof Error ? err.message : 'Could not reach the cluster.',
  }
}

/** Classifies a caught error into the two "quiet empty state" flags + a message. */
export function degrade(
  err: unknown,
): Pick<KubernetesState, 'unavailable' | 'unreachable' | 'error'> {
  if (err instanceof KubeApiError) {
    if (err.code === 'no_kubeconfig') {
      return { unavailable: true, unreachable: false, error: toKubeIssue(err) }
    }
    if (err.code === 'context_unreachable') {
      return { unavailable: false, unreachable: true, error: toKubeIssue(err) }
    }
  }
  return {
    unavailable: false,
    unreachable: false,
    error: toKubeIssue(err),
  }
}
