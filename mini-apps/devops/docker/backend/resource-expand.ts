/**
 * Docker resource expansion — resolves an `image`/`volume`/`network` entity ref (or a
 * container section leaf) to model-facing text. The URI grammar + provider live in
 * `resource-provider.ts`; the node builders in `resource-nodes.ts`.
 */
import type { DockerContainer, DockerEntityPrefix } from './contracts'
import type { ResourceExpansion } from '@localixai/mini-app-sdk/backend'
import { imageLabel, isLive, LOG_TAIL } from './resource-nodes'
import type { ResourceDockerService } from './resource-provider'

/** Resolve an `image`/`volume`/`network` entity ref → model-facing text. */
export async function expandEntity(
  service: ResourceDockerService,
  prefix: DockerEntityPrefix,
  key: string,
): Promise<ResourceExpansion> {
  if (prefix === 'image') {
    const images = await service.listImages()
    const img = images.find((i) => i.id === key || i.id.startsWith(key))
    if (!img) return { ok: false, error: 'image not found' }
    return {
      ok: true,
      content: [
        `Docker image ${imageLabel(img)}.`,
        `ID: ${img.id}.`,
        `Size: ${img.size}.`,
        `Created: ${img.createdAt}.`,
      ].join('\n'),
    }
  }
  if (prefix === 'volume') {
    const volumes = await service.listVolumes()
    const vol = volumes.find((v) => v.name === key)
    if (!vol) return { ok: false, error: 'volume not found' }
    return {
      ok: true,
      content: [
        `Docker volume "${vol.name}".`,
        `Driver: ${vol.driver}.`,
        `Scope: ${vol.scope}.`,
      ].join('\n'),
    }
  }
  const networks = await service.listNetworks()
  const net = networks.find((n) => n.id === key || n.id.startsWith(key) || n.name === key)
  if (!net) return { ok: false, error: 'network not found' }
  return {
    ok: true,
    content: [
      `Docker network "${net.name}".`,
      `ID: ${net.id}.`,
      `Driver: ${net.driver}.`,
      `Scope: ${net.scope}.`,
    ].join('\n'),
  }
}

/** Expand a container's `logs` / `stats` / `processes` section leaf. */
export async function expandContainerSection(
  service: ResourceDockerService,
  container: DockerContainer,
  section: string | undefined,
): Promise<ResourceExpansion> {
  // localix://resource/docker/<id>/logs — tail logs.
  if (section === 'logs') {
    const res = await service.containerLogs(container.id, LOG_TAIL)
    const body = res?.lines?.trim()
    return {
      ok: true,
      content: `Logs for "${container.name}" (last ${LOG_TAIL} lines):\n${body || '(no log output)'}`,
    }
  }

  // localix://resource/docker/<id>/stats — live resource snapshot.
  if (section === 'stats') {
    if (!isLive(container)) return { ok: false, error: 'container is not running' }
    const s = await service.containerStats(container.id)
    if (!s) return { ok: false, error: 'stats unavailable' }
    return {
      ok: true,
      content: [
        `Stats for "${container.name}":`,
        `- CPU: ${s.cpuPct.toFixed(2)}%`,
        `- Memory: ${s.memPct.toFixed(2)}% (${s.memUsage})`,
        `- Net I/O: ${s.netIO}`,
        `- Block I/O: ${s.blockIO}`,
        `- PIDs: ${s.pids}`,
      ].join('\n'),
    }
  }

  // localix://resource/docker/<id>/processes — the `docker top` table.
  if (section === 'processes') {
    if (!isLive(container)) return { ok: false, error: 'container is not running' }
    const top = await service.containerTop(container.id)
    if (top.headers.length === 0) return { ok: false, error: 'processes unavailable' }
    const header = top.headers.join('\t')
    const rows = top.processes.map((r) => r.join('\t')).join('\n')
    return { ok: true, content: `Processes in "${container.name}":\n${header}\n${rows}` }
  }

  return { ok: false, error: 'unresolvable docker uri' }
}
