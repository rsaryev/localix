import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from '../../backend/contracts'
import {
  sortableTimestamp,
  sortResources,
  type ResourceSortValue,
} from '../../../ui/model/resourceSort'
import type { DockerSortState } from './dockerView'

const CONTAINER_STATE_ORDER: Record<DockerContainer['state'], number> = {
  running: 0,
  restarting: 1,
  paused: 2,
  created: 3,
  exited: 4,
  removing: 5,
  dead: 6,
}

export function sortDockerContainers(
  containers: readonly DockerContainer[],
  sort: DockerSortState['containers'],
): DockerContainer[] {
  return sortResources(containers, sort, (container, key): ResourceSortValue => {
    if (key === 'state') return CONTAINER_STATE_ORDER[container.state]
    if (key === 'image') return container.image
    if (key === 'created') return sortableTimestamp(container.createdAt)
    return container.service ?? container.name
  })
}

export function sortDockerImages(
  images: readonly DockerImage[],
  sort: DockerSortState['images'],
): DockerImage[] {
  return sortResources(images, sort, (image, key): ResourceSortValue => {
    if (key === 'size') return image.sizeBytes ?? null
    if (key === 'created') return sortableTimestamp(image.createdAt)
    const tag = image.tag && image.tag !== '<none>' ? `:${image.tag}` : ''
    return `${image.repository}${tag}`
  })
}

export function sortDockerVolumes(
  volumes: readonly DockerVolume[],
  sort: DockerSortState['volumes'],
): DockerVolume[] {
  return sortResources(volumes, sort, (volume, key) => {
    if (key === 'driver') return volume.driver
    if (key === 'scope') return volume.scope
    return volume.name
  })
}

export function sortDockerNetworks(
  networks: readonly DockerNetwork[],
  sort: DockerSortState['networks'],
): DockerNetwork[] {
  return sortResources(networks, sort, (network, key) => {
    if (key === 'driver') return network.driver
    if (key === 'scope') return network.scope
    return network.name
  })
}
