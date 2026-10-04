import type { KubeContext, KubeNamespace, KubeNode } from './contracts'
import { itemsOf, parseJson, str } from './parse-core'
import { parseCpuNanos, parseMemoryBytes } from './metrics'

/**
 * Pure cluster-scope parsers — kubeconfig contexts, namespaces, and nodes. Split out
 * of `parse.ts` (the barrel) unchanged.
 */

/** Parse kubeconfig JSON into contexts + current-context flag. */
export function parseContexts(stdout: string): { contexts: KubeContext[]; current: string } {
  const doc = parseJson(stdout)
  if (!doc || typeof doc !== 'object') return { contexts: [], current: '' }
  const current = str((doc as Record<string, unknown>)['current-context'])
  const rawContexts = (doc as Record<string, unknown>)['contexts']
  const contexts: KubeContext[] = Array.isArray(rawContexts)
    ? rawContexts
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .map((c) => {
          const ctx = (c.context ?? {}) as Record<string, unknown>
          const name = str(c.name)
          return {
            name,
            cluster: str(ctx.cluster),
            namespace: str(ctx.namespace),
            current: name !== '' && name === current,
          }
        })
    : []
  return { contexts, current }
}

/** Parse a serialized NamespaceList. */
export function parseNamespaces(stdout: string): KubeNamespace[] {
  return itemsOf(parseJson(stdout)).map((it) => {
    const meta = (it.metadata ?? {}) as Record<string, unknown>
    const status = (it.status ?? {}) as Record<string, unknown>
    return { name: str(meta.name), phase: str(status.phase) || 'Active' }
  })
}

const NODE_ROLE_PREFIX = 'node-role.kubernetes.io/'

/** Read a node's roles from its `node-role.kubernetes.io/<role>` labels (and the
 *  legacy `kubernetes.io/role` label). Returns a sorted, de-duped list. */
function nodeRoles(labels: Record<string, unknown>): string[] {
  const roles = new Set<string>()
  for (const key of Object.keys(labels)) {
    if (key.startsWith(NODE_ROLE_PREFIX)) {
      const role = key.slice(NODE_ROLE_PREFIX.length)
      if (role) roles.add(role)
    }
  }
  const legacy = str(labels['kubernetes.io/role'])
  if (legacy) roles.add(legacy)
  return [...roles].sort()
}

/** Parse a serialized NodeList into node rows (status/roles/version). */
export function parseNodes(stdout: string): KubeNode[] {
  return itemsOf(parseJson(stdout)).map((it) => {
    const meta = (it.metadata ?? {}) as Record<string, unknown>
    const spec = (it.spec ?? {}) as Record<string, unknown>
    const status = (it.status ?? {}) as Record<string, unknown>
    const labels = (meta.labels ?? {}) as Record<string, unknown>
    const conditions = Array.isArray(status.conditions)
      ? (status.conditions as Record<string, unknown>[]).filter((c) => c && typeof c === 'object')
      : []
    const ready = conditions.find((c) => str(c.type) === 'Ready')
    const nodeInfo = (status.nodeInfo ?? {}) as Record<string, unknown>
    const allocatable = (status.allocatable ?? {}) as Record<string, unknown>
    return {
      name: str(meta.name),
      status: str(ready?.status) === 'True' ? 'Ready' : 'NotReady',
      roles: nodeRoles(labels),
      version: str(nodeInfo.kubeletVersion),
      schedulable: spec.unschedulable !== true,
      createdAt: str(meta.creationTimestamp),
      allocatableCpuNanos: parseCpuNanos(allocatable.cpu),
      allocatableMemoryBytes: parseMemoryBytes(allocatable.memory),
    }
  })
}
