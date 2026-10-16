import type { KubeManifestKind } from '../../backend/contracts'
import { nodeUri, podUri, workloadUri, type WorkloadKind } from '../../backend/resource-nodes'
import { encodeResourceSegment } from '@localixai/plugin-sdk/resource-refs'

export interface K8sManifestRef {
  kind: KubeManifestKind
  name: string
  /** The namespace — ignored for cluster-scoped nodes. */
  namespace: string
  context?: string
}

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

/**
 * Build the `localix://resource/k8s/…/manifest` resource URI the composer links, matching the k8s
 * resource provider's grammar:
 *   pod                → localix://resource/k8s/<ctx>/<ns>/<pod>/manifest
 *   deployment/service → localix://resource/k8s/<ctx>/<ns>/<kind>/<name>/manifest
 *   node               → localix://resource/k8s/<ctx>/node/<name>/manifest (cluster-scoped)
 * A blank context yields a `current` marker so the URI still parses (the provider
 * falls back to kubeconfig's current-context).
 */
export function buildK8sManifestUri({ kind, name, namespace, context }: K8sManifestRef): string {
  if (kind === 'node') return buildK8sNodeViewUri({ name, context, view: 'manifest' })
  if (kind === 'pod') {
    return buildK8sPodViewUri({ name, namespace, context, view: 'manifest' })
  }
  return buildK8sWorkloadViewUri({ kind, name, namespace, context, view: 'manifest' })
}
