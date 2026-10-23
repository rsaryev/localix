/**
 * Docker resource-tree node builders — the pure/lookup half of the `localix://resource/docker`
 * resource provider (see `resource-provider.ts` for the grammar + provider). Category
 * folders, container section leaves, and the per-category listings all live here.
 */
import type { DockerCategory, DockerContainer, DockerEntityPrefix, DockerImage } from './contracts'
import { DOCKER_CATEGORIES, DOCKER_ENTITY_PREFIXES } from './contracts'
import type { ResourceNode } from '@localixai/mini-app-sdk/backend'
import { buildResourceUri, linkAction } from '@localixai/mini-app-sdk/backend'
import type { ResourceDockerService } from './resource-provider'

/** The URI provider this mini app owns. */
export const PROVIDER = 'docker'

/** How many trailing log lines a `logs` node expands to. */
export const LOG_TAIL = 400

// Category folders + entity prefixes come from contracts.ts — one token set shared
// with the UI-anchor activation, so the reserved-word grammar can't drift.
export const isCategory = (s: string): s is DockerCategory =>
  (DOCKER_CATEGORIES as readonly string[]).includes(s)
export const isEntityPrefix = (s: string): s is DockerEntityPrefix =>
  (DOCKER_ENTITY_PREFIXES as readonly string[]).includes(s)

export const containerUri = (id: string) => buildResourceUri(PROVIDER, [id])
export const imageLabel = (i: DockerImage) =>
  i.tag && i.tag !== '<none>' ? `${i.repository}:${i.tag}` : i.repository

/** A container is "live" (stats/top make sense) when running or restarting. */
export const isLive = (c: DockerContainer) => c.state === 'running' || c.state === 'restarting'

/** Resolve a container by id or short-id prefix (matches the workbench tab). */
export async function findContainer(
  service: ResourceDockerService,
  id: string,
): Promise<DockerContainer | undefined> {
  const list = await service.listContainers()
  return list.find((c) => c.id === id || c.id.startsWith(id))
}

export function sectionNodes(c: DockerContainer): ResourceNode[] {
  const nodes: ResourceNode[] = [
    {
      uri: `${containerUri(c.id)}/logs`,
      label: 'Logs',
      detail: `last ${LOG_TAIL} lines`,
      hasChildren: false,
      icon: 'logs',
    },
  ]
  if (isLive(c)) {
    nodes.push(
      {
        uri: `${containerUri(c.id)}/stats`,
        label: 'Stats',
        detail: 'CPU / mem / IO',
        hasChildren: false,
        icon: 'stats',
      },
      {
        uri: `${containerUri(c.id)}/processes`,
        label: 'Processes',
        detail: 'docker top',
        hasChildren: false,
        icon: 'processes',
      },
    )
  }
  return nodes
}

/** The four top-level category folders. */
export function categoryNodes(): ResourceNode[] {
  return [
    {
      uri: buildResourceUri(PROVIDER, ['containers']),
      label: 'Containers',
      hasChildren: true,
      icon: 'container',
    },
    {
      uri: buildResourceUri(PROVIDER, ['images']),
      label: 'Images',
      hasChildren: true,
      icon: 'image',
    },
    {
      uri: buildResourceUri(PROVIDER, ['volumes']),
      label: 'Volumes',
      hasChildren: true,
      icon: 'volume',
    },
    {
      uri: buildResourceUri(PROVIDER, ['networks']),
      label: 'Networks',
      hasChildren: true,
      icon: 'network',
    },
  ]
}

/** The items inside a category folder. */
export async function categoryChildren(
  service: ResourceDockerService,
  cat: DockerCategory,
): Promise<ResourceNode[]> {
  if (cat === 'containers') {
    const containers = await service.listContainers()
    return containers.map((c) => ({
      uri: containerUri(c.id),
      label: c.name,
      detail: `${c.state} · ${c.image}`,
      hasChildren: true,
      icon: 'container',
      actions: linkAction('Link this container'),
    }))
  }
  if (cat === 'images') {
    const images = await service.listImages()
    return images.map((i) => ({
      uri: buildResourceUri(PROVIDER, ['image', i.id]),
      label: imageLabel(i),
      detail: i.size,
      hasChildren: false,
      icon: 'image',
    }))
  }
  if (cat === 'volumes') {
    const volumes = await service.listVolumes()
    return volumes.map((v) => ({
      uri: buildResourceUri(PROVIDER, ['volume', v.name]),
      label: v.name,
      detail: v.driver,
      hasChildren: false,
      icon: 'volume',
    }))
  }
  const networks = await service.listNetworks()
  return networks.map((n) => ({
    uri: buildResourceUri(PROVIDER, ['network', n.id]),
    label: n.name,
    detail: `${n.driver} · ${n.scope}`,
    hasChildren: false,
    icon: 'network',
  }))
}
