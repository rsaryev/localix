/**
 * K8s resource-tree drill-down — the `listChildren` half of the `localix://resource/k8s` resource
 * provider (see `resource-provider.ts` for the grammar + provider shape).
 */
import type { ResourceNode } from '@localixai/mini-app-sdk/backend'
import {
  decodeResourceSegment,
  linkAction,
  providerSegments,
} from '@localixai/mini-app-sdk/backend'
import type { ResourceKubernetesService } from './resource-provider'
import {
  ctxUri,
  failureNotice,
  isWorkloadKind,
  nodeSectionNodes,
  nodesUri,
  nodeUri,
  nsUri,
  podSectionNodes,
  podUri,
  PROVIDER,
  workloadSectionNodes,
  workloadUri,
} from './resource-nodes'

export async function listResourceChildren(
  service: ResourceKubernetesService,
  parentUri: string | null,
): Promise<ResourceNode[]> {
  if (parentUri === null) {
    const { contexts } = await service.listContexts()
    return contexts.map((c) => ({
      uri: ctxUri(c.name),
      label: c.name,
      detail: c.current ? 'current' : c.cluster || undefined,
      hasChildren: true,
      icon: 'k8s-context',
    }))
  }
  const segs = providerSegments(PROVIDER, parentUri)
  if (!segs) return []
  const [, rawS1, rawS2] = segs
  const [ctx, s1, s2, s3] = segs.map(decodeResourceSegment)
  if (!ctx) return []

  // localix://resource/k8s/<ctx> — namespaces + a synthetic Nodes folder.
  if (segs.length === 1) {
    const namespaces = await service.listNamespaces(ctx)
    const nsNodes: ResourceNode[] = namespaces.map((n) => ({
      uri: nsUri(ctx, n.name),
      label: n.name,
      detail: n.phase,
      hasChildren: true,
      icon: 'k8s-namespace',
      actions: linkAction('Link this namespace'),
    }))
    return [
      {
        uri: nodesUri(ctx),
        label: 'Nodes',
        detail: 'cluster-scoped',
        hasChildren: true,
        icon: 'k8s-node',
      },
      ...nsNodes,
    ]
  }
  // localix://resource/k8s/<ctx>/node — the cluster's nodes.
  if (segs.length === 2 && rawS1 === 'node') {
    const nodes = await service.listNodes(ctx)
    return nodes.map((n) => ({
      uri: nodeUri(ctx, n.name),
      label: n.name,
      detail: `${n.status}${n.roles.length ? ` · ${n.roles.join(',')}` : ''}`,
      hasChildren: true,
      icon: 'k8s-node',
      actions: linkAction('Link this node'),
    }))
  }
  // localix://resource/k8s/<ctx>/<ns> — the namespace's pods + deployments + services.
  if (segs.length === 2 && s1) {
    const ns = s1
    // Settled, not `all`: RBAC commonly grants one kind and refuses another, and the two the
    // user CAN see are still the answer. A refused kind rides in as its own notice row.
    const settled = await Promise.allSettled([
      service.listPods(ns, ctx),
      service.listDeployments(ns, ctx),
      service.listServices(ns, ctx),
    ])
    const [podList, deploymentList, serviceList] = settled
    const pods = podList.status === 'fulfilled' ? podList.value : []
    const deployments = deploymentList.status === 'fulfilled' ? deploymentList.value : []
    const services = serviceList.status === 'fulfilled' ? serviceList.value : []
    // Keyed by label: three kinds refused for one reason is one fact, not three rows.
    const failures = new Map<string, ResourceNode>()
    for (const result of settled) {
      if (result.status !== 'rejected') continue
      const notice = failureNotice(parentUri, result.reason)
      failures.set(notice.label, notice)
    }
    return [
      ...failures.values(),
      ...deployments.map((d) => ({
        uri: workloadUri(ctx, ns, 'deployment', d.name),
        label: d.name,
        detail: `deployment · ${d.ready}`,
        hasChildren: true,
        icon: 'k8s-deployment',
        actions: linkAction('Link this deployment'),
      })),
      ...services.map((s) => ({
        uri: workloadUri(ctx, ns, 'service', s.name),
        label: s.name,
        detail: `service · ${s.type}`,
        hasChildren: true,
        icon: 'k8s-service',
        actions: linkAction('Link this service'),
      })),
      ...pods.map((p) => ({
        uri: podUri(ctx, ns, p.name),
        label: p.name,
        detail: `${p.reason || p.phase} · ${p.ready}`,
        hasChildren: true,
        icon: 'k8s-pod',
        actions: linkAction('Link this pod'),
      })),
    ]
  }
  // localix://resource/k8s/<ctx>/node/<name> — a node's describe/manifest leaves.
  if (segs.length === 3 && rawS1 === 'node' && s2) return nodeSectionNodes(ctx, s2)
  // localix://resource/k8s/<ctx>/<ns>/<pod> — a pod's logs/describe/events/manifest leaves.
  if (segs.length === 3 && s1 && s2) return podSectionNodes(ctx, s1, s2)
  // localix://resource/k8s/<ctx>/<ns>/<kind>/<name> — a workload's describe/events/manifest leaves.
  if (segs.length === 4 && s1 && isWorkloadKind(rawS2) && s3)
    return workloadSectionNodes(ctx, s1, rawS2, s3)
  return []
}
