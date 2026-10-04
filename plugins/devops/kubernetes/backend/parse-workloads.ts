import type { KubeDeployment, KubeEvent, KubeService } from './contracts'
import { itemsOf, num, parseJson, str } from './parse-core'

/**
 * Pure workload parsers — deployments (rows + pod-selector), services, and the
 * per-resource event feed. Split out of `parse.ts` (the barrel) unchanged.
 */

/** Parse a serialized DeploymentList. */
export function parseDeployments(stdout: string): KubeDeployment[] {
  return itemsOf(parseJson(stdout)).map((it) => {
    const meta = (it.metadata ?? {}) as Record<string, unknown>
    const spec = (it.spec ?? {}) as Record<string, unknown>
    const status = (it.status ?? {}) as Record<string, unknown>
    const desired = num(spec.replicas)
    const ready = num(status.readyReplicas)
    return {
      name: str(meta.name),
      namespace: str(meta.namespace),
      ready: `${ready}/${desired}`,
      upToDate: num(status.updatedReplicas),
      available: num(status.availableReplicas),
      createdAt: str(meta.creationTimestamp),
    }
  })
}

/** Parse a serialized Deployment document into its pod-selector
 *  match labels (`spec.selector.matchLabels`). Returns `{}` when absent/invalid. */
export function parseDeploymentSelector(stdout: string): Record<string, string> {
  const doc = parseJson(stdout)
  if (!doc || typeof doc !== 'object') return {}
  const spec = ((doc as Record<string, unknown>).spec ?? {}) as Record<string, unknown>
  const selector = (spec.selector ?? {}) as Record<string, unknown>
  const matchLabels = (selector.matchLabels ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(matchLabels)) {
    if (typeof k === 'string' && k) out[k] = str(v)
  }
  return out
}

/** Build an API equality label selector (`k=v,k=v`) from a match-labels map,
 *  keys sorted for a stable, testable string. Empty map → `''` (no selector). */
export function buildLabelSelector(matchLabels: Record<string, string>): string {
  return Object.keys(matchLabels)
    .sort()
    .map((k) => `${k}=${matchLabels[k]}`)
    .join(',')
}

/** Parse a serialized EventList (already field-selected to one resource). Sorted
 *  most-recent-last-seen first so the freshest events are on top. */
export function parseEvents(stdout: string): KubeEvent[] {
  const events = itemsOf(parseJson(stdout)).map((it) => {
    const source = (it.source ?? {}) as Record<string, unknown>
    // Newer clusters put the emitter on `reportingComponent`; fall back to `source.component`.
    const emitter = str(it.reportingComponent) || str(source.component) || str(source.host)
    const lastSeen = str(it.lastTimestamp) || str(it.eventTime) || str(it.firstTimestamp)
    return {
      type: str(it.type) || 'Normal',
      reason: str(it.reason),
      message: str(it.message),
      count: num(it.count) || 1,
      source: emitter,
      lastSeen,
    }
  })
  return events.sort((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0))
}

/** Parse a serialized ServiceList. */
export function parseServices(stdout: string): KubeService[] {
  return itemsOf(parseJson(stdout)).map((it) => {
    const meta = (it.metadata ?? {}) as Record<string, unknown>
    const spec = (it.spec ?? {}) as Record<string, unknown>
    const ports = Array.isArray(spec.ports)
      ? (spec.ports as Record<string, unknown>[])
          .map((p) => `${num(p.port)}/${str(p.protocol) || 'TCP'}`)
          .join(',')
      : ''
    return {
      name: str(meta.name),
      namespace: str(meta.namespace),
      type: str(spec.type) || 'ClusterIP',
      clusterIP: str(spec.clusterIP),
      ports,
      createdAt: str(meta.creationTimestamp),
    }
  })
}
