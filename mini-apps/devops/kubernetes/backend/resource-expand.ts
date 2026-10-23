/**
 * K8s resource expansion — resolves a `localix://resource/k8s/…` node to model-facing text (the
 * `expand` half of the resource provider; see `resource-provider.ts` for the
 * grammar + provider shape).
 */
import type { ResourceExpansion } from '@localixai/mini-app-sdk/backend'
import { decodeResourceSegment, providerSegments } from '@localixai/mini-app-sdk/backend'
import type { ResourceKubernetesService } from './resource-provider'
import { isWorkloadKind, LOG_TAIL, PROVIDER } from './resource-nodes'

export async function expandResource(
  service: ResourceKubernetesService,
  uri: string,
): Promise<ResourceExpansion> {
  const segs = providerSegments(PROVIDER, uri)
  if (!segs) return { ok: false, error: 'not a k8s resource' }
  const [, rawS1, rawS2] = segs
  const [ctx, s1, s2, s3, s4, s5, s6] = segs.map(decodeResourceSegment)
  if (!ctx) return { ok: false, error: 'missing context' }

  // localix://resource/k8s/<ctx> — the context's namespaces listing.
  if (segs.length === 1) {
    const namespaces = await service.listNamespaces(ctx)
    const body = namespaces.map((n) => `- ${n.name} (${n.phase})`).join('\n')
    return { ok: true, content: `Context "${ctx}" — ${namespaces.length} namespaces:\n${body}` }
  }
  // localix://resource/k8s/<ctx>/node — the cluster's nodes listing.
  if (segs.length === 2 && s1 === 'node') {
    const nodes = await service.listNodes(ctx)
    const body = nodes
      .map(
        (n) =>
          `- ${n.name} · ${n.status}${n.roles.length ? ` · ${n.roles.join(',')}` : ''}${n.version ? ` · ${n.version}` : ''}`,
      )
      .join('\n')
    return { ok: true, content: `Cluster "${ctx}" — ${nodes.length} nodes:\n${body}` }
  }
  // localix://resource/k8s/<ctx>/<ns> — the namespace's pods listing.
  if (segs.length === 2 && s1) {
    const pods = await service.listPods(s1, ctx)
    const body = pods
      .map(
        (p) =>
          `- ${p.name} · ${p.phase} · ready ${p.ready}${p.restarts ? ` · ${p.restarts} restarts` : ''}${p.reason ? ` · ${p.reason}` : ''}`,
      )
      .join('\n')
    return {
      ok: true,
      content: `Namespace "${s1}" in "${ctx}" — ${pods.length} pods:\n${body}`,
    }
  }

  // ---- Node (cluster-scoped) ----
  if (rawS1 === 'node' && s2) {
    // localix://resource/k8s/<ctx>/node/<name> or /describe → describe; /manifest → YAML.
    if (segs.length === 3 || (segs.length === 4 && s3 === 'describe')) {
      const res = await service.describeNode(s2, ctx)
      return { ok: true, content: res?.text?.trim() || `(no describe output for node ${s2})` }
    }
    if (segs.length === 4 && s3 === 'manifest') {
      const res = await service.getManifest('node', s2, undefined, ctx)
      return {
        ok: true,
        content: res?.yaml?.trim() || `(no manifest for node ${s2})`,
        language: 'yaml',
      }
    }
    return { ok: false, error: 'unresolvable k8s node uri' }
  }

  // ---- Workload (deployment/service) ----
  if (segs.length >= 4 && s1 && isWorkloadKind(rawS2) && s3) {
    const ns = s1
    const kind = rawS2
    const name = s3
    // localix://resource/k8s/<ctx>/<ns>/<kind>/<name> or /describe → describe.
    if (segs.length === 4 || s4 === 'describe') {
      const res = await service.describeResource(kind, ns, name, ctx)
      return {
        ok: true,
        content: res?.text?.trim() || `(no describe output for ${kind} ${name})`,
      }
    }
    if (s4 === 'events') {
      const events = await service.resourceEvents(kind, ns, name, ctx)
      if (events.length === 0)
        return { ok: true, content: `No recent events for ${kind} "${name}".` }
      const body = events
        .map((e) => `- [${e.type}] ${e.reason}${e.count > 1 ? ` ×${e.count}` : ''}: ${e.message}`)
        .join('\n')
      return { ok: true, content: `Events for ${kind} "${name}" (${ns}):\n${body}` }
    }
    if (s4 === 'manifest') {
      const res = await service.getManifest(kind, name, ns, ctx)
      return {
        ok: true,
        content: res?.yaml?.trim() || `(no manifest for ${kind} ${name})`,
        language: 'yaml',
      }
    }
    return { ok: false, error: 'unresolvable k8s workload uri' }
  }

  // ---- Pod ----
  if (!s1 || !s2) return { ok: false, error: 'unresolvable k8s uri' }
  const ns = s1
  const pod = s2
  // localix://resource/k8s/<ctx>/<ns>/<pod> — a pod summary. Fetch just this one pod (not the whole
  // namespace) to render its row.
  if (segs.length === 3) {
    const p = await service.getPod(ns, pod, ctx)
    if (!p) return { ok: false, error: 'pod not found' }
    const lines = [
      `Pod "${p.name}" in ${ns} (${ctx}) — ${p.phase}${p.reason ? ` (${p.reason})` : ''}.`,
      `Ready: ${p.ready}. Restarts: ${p.restarts}.`,
    ]
    if (p.node) lines.push(`Node: ${p.node}.`)
    if (p.podIP) lines.push(`Pod IP: ${p.podIP}.`)
    if (p.containers.length) lines.push(`Containers: ${p.containers.join(', ')}.`)
    return { ok: true, content: lines.join('\n') }
  }
  // Pod section leaves.
  if (s3 === 'logs') {
    const refined = segs.length > 4
    if (
      refined &&
      !(
        (segs.length === 6 || segs.length === 7) &&
        s4 === 'container' &&
        s5 &&
        (segs.length === 6 || s6 === 'previous')
      )
    ) {
      return { ok: false, error: 'unresolvable k8s logs uri' }
    }
    const container = refined ? s5 : undefined
    const previous = segs.length === 7
    const res = await service.podLogs(ns, pod, {
      tail: LOG_TAIL,
      context: ctx,
      ...(container ? { container } : {}),
      ...(previous ? { previous: true } : {}),
    })
    const body = res?.lines?.trim()
    const selected = container ? `, container ${container}${previous ? ', previous' : ''}` : ''
    return {
      ok: true,
      content: `Logs for pod "${pod}" (${ns}${selected}, last ${LOG_TAIL} lines):\n${body || '(no log output)'}`,
    }
  }
  if (s3 === 'describe') {
    const res = await service.describePod(ns, pod, ctx)
    return { ok: true, content: res?.text?.trim() || `(no describe output for ${pod})` }
  }
  if (s3 === 'events') {
    const events = await service.podEvents(ns, pod, ctx)
    if (events.length === 0) return { ok: true, content: `No recent events for pod "${pod}".` }
    const body = events
      .map((e) => `- [${e.type}] ${e.reason}${e.count > 1 ? ` ×${e.count}` : ''}: ${e.message}`)
      .join('\n')
    return { ok: true, content: `Events for pod "${pod}" (${ns}):\n${body}` }
  }
  if (s3 === 'manifest') {
    const res = await service.getManifest('pod', pod, ns, ctx)
    return {
      ok: true,
      content: res?.yaml?.trim() || `(no manifest for pod ${pod})`,
      language: 'yaml',
    }
  }

  return { ok: false, error: 'unresolvable k8s uri' }
}
