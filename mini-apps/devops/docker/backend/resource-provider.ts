/**
 * DOCKER resource provider — a `ResourceRefProvider` (agent-core resource-refs)
 * owning the `${PROVIDER}://` provider, sibling of the database / git / chat / k8s providers.
 * It turns the host's Docker primitives into a referenceable tree the composer `@`-menu
 * drills (category → entity → container leaves) and resolves a node to model-facing
 * text, so a user can drag a container / image / volume / network (or a container's
 * logs) into chat, or reach any of them via `@`.
 *
 * URI grammar (positional):
 *   localix://resource/docker/containers          → the Containers CATEGORY (folder → containers)
 *   localix://resource/docker/images              → the Images CATEGORY (folder → images)
 *   localix://resource/docker/volumes             → the Volumes CATEGORY (folder → volumes)
 *   localix://resource/docker/networks            → the Networks CATEGORY (folder → networks)
 *   localix://resource/docker/<id>                → a container (folder → its logs/stats/processes)
 *   localix://resource/docker/<id>/logs           → the container's tail logs (leaf)
 *   localix://resource/docker/<id>/stats          → live CPU/mem/IO snapshot (leaf, running only)
 *   localix://resource/docker/<id>/processes     → the process table `docker top` (leaf, running only)
 *   localix://resource/docker/image/<id>          → an image (leaf → repo:tag / id / size / created)
 *   localix://resource/docker/volume/<name>       → a volume (leaf → name / driver / scope)
 *   localix://resource/docker/network/<id>        → a network (leaf → name / id / driver / scope)
 *
 * The reserved first segments `containers`/`images`/`volumes`/`networks` are category
 * folders (never a container id — a container id is hex, never one of those words), and
 * `image`/`volume`/`network` (with a trailing segment) disambiguate an entity ref from a
 * bare container id.
 *
 * ZERO new introspection: reuses the read methods already on `DockerService`
 * (`listContainers`/`listImages`/`listVolumes`/`listNetworks`/`containerLogs`/
 * `containerStats`/`containerTop`) via a narrow structural port. Introspection only —
 * it never surfaces anything the workbench UI doesn't already.
 *
 * The node builders live in `resource-nodes.ts`; the leaf/entity expansion in
 * `resource-expand.ts`. This file owns the grammar dispatch + the provider shape.
 */
import type {
  ContainerLogs,
  ContainerStats,
  ContainerTop,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from './contracts'
import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import { buildResourceUri, noticeNode, providerSegments } from '@localixai/mini-app-sdk/backend'
import { mapDockerError } from './errors'
import {
  categoryChildren,
  categoryNodes,
  findContainer,
  isCategory,
  isEntityPrefix,
  PROVIDER,
  sectionNodes,
} from './resource-nodes'
import { expandContainerSection, expandEntity } from './resource-expand'

/** Narrow structural port over `DockerService` — the only reads this provider needs. */
export interface ResourceDockerService {
  listContainers(): Promise<DockerContainer[]>
  listImages(): Promise<DockerImage[]>
  listVolumes(): Promise<DockerVolume[]>
  listNetworks(): Promise<DockerNetwork[]>
  containerLogs(id: string, tail: number): Promise<ContainerLogs>
  containerStats(id: string): Promise<ContainerStats | null>
  containerTop(id: string): Promise<ContainerTop>
}

export function createDockerResourceProvider(service: ResourceDockerService): ResourceRefProvider {
  const children = async (parentUri: string | null): Promise<ResourceNode[]> => {
    if (parentUri === null) return categoryNodes()
    const segments = providerSegments(PROVIDER, parentUri)
    if (!segments) return []
    const [head] = segments
    if (!head) return []
    // A category folder → its items.
    if (segments.length === 1 && isCategory(head)) return categoryChildren(service, head)
    // A bare container id → its logs/stats/processes leaves.
    if (segments.length === 1) {
      const container = await findContainer(service, head)
      return container ? sectionNodes(container) : []
    }
    // image/volume/network entity refs are leaves.
    return []
  }

  const expandUri = async (uri: string): Promise<ResourceExpansion> => {
    const segments = providerSegments(PROVIDER, uri)
    if (!segments) return { ok: false, error: 'not a docker resource' }
    const [head, section] = segments
    if (!head) return { ok: false, error: 'missing docker id' }

    // localix://resource/docker/image/<id> · localix://resource/docker/volume/<name> · localix://resource/docker/network/<id>
    if (isEntityPrefix(head) && segments.length >= 2) {
      return expandEntity(service, head, segments.slice(1).join('/'))
    }

    // localix://resource/docker/<category> — a listing summary of that category.
    if (segments.length === 1 && isCategory(head)) {
      const items = await categoryChildren(service, head)
      const body = items.map((n) => `- ${n.label}${n.detail ? ` (${n.detail})` : ''}`).join('\n')
      return { ok: true, content: `Docker ${head} — ${items.length}:\n${body || '(none)'}` }
    }

    const container = await findContainer(service, head)
    if (!container) return { ok: false, error: 'container not found' }

    // localix://resource/docker/<id> — a container summary.
    if (segments.length === 1) {
      const lines = [
        `Docker container "${container.name}" (${container.state}).`,
        `Image: ${container.image}.`,
        `Status: ${container.status}.`,
      ]
      if (container.ports) lines.push(`Ports: ${container.ports}.`)
      lines.push(`Created: ${container.createdAt}.`)
      return { ok: true, content: lines.join('\n') }
    }

    // localix://resource/docker/<id>/{logs,stats,processes} — the container's section leaves.
    return expandContainerSection(service, container, section)
  }

  return {
    provider: PROVIDER,
    title: 'Docker',

    // ONE classification point for the whole tree. A dead daemon must never read as an empty
    // Containers folder or "container not found" — the drill-down has no error channel, so the
    // failure rides in as a notice row; an expansion says so in its `error`.
    async listChildren(_userId, parentUri) {
      try {
        return await children(parentUri)
      } catch (err) {
        const mapped = mapDockerError(err)
        return [
          noticeNode(
            parentUri ?? buildResourceUri(PROVIDER),
            mapped.friendly,
            mapped.message === mapped.friendly ? undefined : mapped.message,
          ),
        ]
      }
    },

    async expand(_userId, uri): Promise<ResourceExpansion> {
      try {
        return await expandUri(uri)
      } catch (err) {
        return { ok: false, error: mapDockerError(err).friendly }
      }
    },
  }
}
