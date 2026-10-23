/**
 * URI activation for `localix://resource/docker/…`: which tab (or which workspace
 * area) a Docker resource reference opens.
 */
import { parseLocalixResourceUri } from '@localixai/mini-app-sdk/ui'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import { DOCKER_CATEGORIES, DOCKER_ENTITY_PREFIXES } from '../../backend/contracts'
import { saveDevOpsArea } from '../../../ui/model/devopsView'

/** Reserved category / entity tokens that are NOT a bare container id (a `localix://resource/docker`
 *  hit with a single non-reserved segment is a container). Shared with the backend
 *  resource provider via contracts so the grammar can't drift. */
const RESERVED_DOCKER = new Set<string>([...DOCKER_CATEGORIES, ...DOCKER_ENTITY_PREFIXES])

const DOCKER_AREA_RESOURCE: Record<string, 'images' | 'volumes' | 'networks'> = {
  image: 'images',
  images: 'images',
  volume: 'volumes',
  volumes: 'volumes',
  network: 'networks',
  networks: 'networks',
}

export function resolveDockerAnchor(id: string) {
  const parsed = parseLocalixResourceUri(id)
  if (parsed?.provider !== 'docker') return null
  const seg = parsed.segments.map((segment) => decodeURIComponent(segment))
  if (seg[0] && !RESERVED_DOCKER.has(seg[0])) {
    return {
      kind: 'work-item' as const,
      workKind: 'devops:docker-container',
      id: `devops:docker-container:${seg[0]}`,
      title: seg[0],
      payload: { containerId: seg[0], name: seg[0] },
    }
  }
  if ((seg[0] === 'image' || seg[0] === 'volume' || seg[0] === 'network') && seg[1]) {
    const resourceKind = seg[0]
    const uri = localixResourceUri('docker', [resourceKind, seg[1]])
    return {
      kind: 'work-item' as const,
      workKind: 'devops:docker-resource',
      id: `devops:docker-resource:${uri}`,
      title: seg[1],
      payload: { resourceKind, resourceIdentity: seg[1], uri },
    }
  }
  saveDevOpsArea('containers')
  return {
    kind: 'work-item' as const,
    workKind: 'devops:workspace',
    id: 'devops:workspace',
    title: 'DevOps Workspace',
    payload: {
      area: 'containers',
      dockerResource: DOCKER_AREA_RESOURCE[seg[0] ?? ''] ?? 'containers',
    },
  }
}
