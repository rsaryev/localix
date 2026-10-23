/**
 * K8s resource-tree URI builders + section-leaf node builders — the pure half of the
 * `localix://resource/k8s` resource provider (see `resource-provider.ts` for the grammar + provider).
 */
import type { ResourceNode } from '@localixai/mini-app-sdk/resource-refs'
import {
  buildResourceUri,
  encodeResourceSegment,
  noticeNode,
} from '@localixai/mini-app-sdk/resource-refs'
import { mapKubeError } from './errors'

/** The URI provider this mini app owns. */
export const PROVIDER = 'k8s'

/** How many trailing log lines a `logs` node expands to. */
export const LOG_TAIL = 400

/** The kind-segment literals a namespaced workload URI carries. */
export const WORKLOAD_KINDS = ['deployment', 'service'] as const
export type WorkloadKind = (typeof WORKLOAD_KINDS)[number]
export const isWorkloadKind = (s: string | undefined): s is WorkloadKind =>
  s === 'deployment' || s === 'service'

/** A failed cluster read as a non-drillable row: the sentence as the label, the raw text beside
 *  it. The drill-down has no error channel, and an empty folder is not the same fact. */
export function failureNotice(parentUri: string | null, err: unknown): ResourceNode {
  const mapped = mapKubeError(err)
  return noticeNode(
    parentUri ?? buildResourceUri(PROVIDER),
    mapped.friendly,
    mapped.message === mapped.friendly ? undefined : mapped.message,
  )
}

/**
 * Dynamic Kubernetes names share a positional grammar with marker segments.
 * Percent-encode the first byte when a real namespace/pod equals a marker, so
 * `namespace "node"` cannot alias the Nodes folder and `pod "deployment"`
 * cannot alias a deployment route. Parsers compare the raw marker first, then
 * decode dynamic segments before passing them to Kubernetes-facing services.
 */
const encodeDynamicSegment = (value: string, reserved: readonly string[] = []): string => {
  const encoded = encodeResourceSegment(value)
  if (!reserved.includes(encoded)) return encoded
  const first = encoded.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  return `%${first}${encoded.slice(1)}`
}

export const ctxUri = (ctx: string) => buildResourceUri(PROVIDER, [ctx])
export const nsUri = (ctx: string, ns: string) =>
  `${ctxUri(ctx)}/${encodeDynamicSegment(ns, ['node'])}`
export const podUri = (ctx: string, ns: string, pod: string) =>
  `${nsUri(ctx, ns)}/${encodeDynamicSegment(pod, WORKLOAD_KINDS)}`
export const nodesUri = (ctx: string) => `${ctxUri(ctx)}/node`
export const nodeUri = (ctx: string, name: string) =>
  `${nodesUri(ctx)}/${encodeResourceSegment(name)}`
export const workloadUri = (ctx: string, ns: string, kind: WorkloadKind, name: string) =>
  `${nsUri(ctx, ns)}/${kind}/${encodeResourceSegment(name)}`

export function podSectionNodes(ctx: string, ns: string, pod: string): ResourceNode[] {
  const b = podUri(ctx, ns, pod)
  return [
    {
      uri: `${b}/logs`,
      label: 'Logs',
      detail: `last ${LOG_TAIL} lines`,
      hasChildren: false,
      icon: 'logs',
    },
    { uri: `${b}/describe`, label: 'Describe', hasChildren: false, icon: 'file' },
    { uri: `${b}/events`, label: 'Events', hasChildren: false, icon: 'events' },
    { uri: `${b}/manifest`, label: 'Manifest', detail: 'YAML', hasChildren: false, icon: 'file' },
  ]
}

export function workloadSectionNodes(
  ctx: string,
  ns: string,
  kind: WorkloadKind,
  name: string,
): ResourceNode[] {
  const b = workloadUri(ctx, ns, kind, name)
  return [
    { uri: `${b}/describe`, label: 'Describe', hasChildren: false, icon: 'file' },
    { uri: `${b}/events`, label: 'Events', hasChildren: false, icon: 'events' },
    { uri: `${b}/manifest`, label: 'Manifest', detail: 'YAML', hasChildren: false, icon: 'file' },
  ]
}

export function nodeSectionNodes(ctx: string, name: string): ResourceNode[] {
  const b = nodeUri(ctx, name)
  return [
    { uri: `${b}/describe`, label: 'Describe', hasChildren: false, icon: 'file' },
    { uri: `${b}/manifest`, label: 'Manifest', detail: 'YAML', hasChildren: false, icon: 'file' },
  ]
}
