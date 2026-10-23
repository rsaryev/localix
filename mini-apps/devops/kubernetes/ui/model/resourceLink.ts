import { nodeUri, podUri, workloadUri, type WorkloadKind } from '../../backend/resource-nodes'
import { encodeResourceSegment } from '@localixai/mini-app-sdk/resource-refs'

type K8sPodView = 'logs' | 'describe' | 'events' | 'manifest'
type K8sWorkloadView = 'describe' | 'events' | 'manifest'
type K8sNodeView = 'describe' | 'manifest'

function contextName(context?: string): string {
  return context?.trim() || 'current'
}

/** Canonical roots shared by tab bindings, drag surfaces and live publications. */
export function buildK8sPodUri(input: {
  name: string
  namespace: string
  context?: string
}): string {
  return podUri(contextName(input.context), input.namespace, input.name)
}

export function buildK8sWorkloadUri(input: {
  kind: WorkloadKind
  name: string
  namespace: string
  context?: string
}): string {
  return workloadUri(contextName(input.context), input.namespace, input.kind, input.name)
}

export function buildK8sNodeUri(input: { name: string; context?: string }): string {
  return nodeUri(contextName(input.context), input.name)
}

/**
 * Exact pod surface currently visible in the editor. Logs may refine the base
 * provider leaf with the selected container and terminated-container snapshot.
 */
export function buildK8sPodViewUri(input: {
  name: string
  namespace: string
  context?: string
  view: K8sPodView
  container?: string
  previous?: boolean
}): string {
  const base = `${buildK8sPodUri(input)}/${input.view}`
  if (input.view !== 'logs' || !input.container) return base
  return `${base}/container/${encodeResourceSegment(input.container)}${
    input.previous ? '/previous' : ''
  }`
}

export function buildK8sWorkloadViewUri(input: {
  kind: WorkloadKind
  name: string
  namespace: string
  context?: string
  view: K8sWorkloadView
}): string {
  return `${buildK8sWorkloadUri(input)}/${input.view}`
}

export function buildK8sNodeViewUri(input: {
  name: string
  context?: string
  view: K8sNodeView
}): string {
  return `${buildK8sNodeUri(input)}/${input.view}`
}
