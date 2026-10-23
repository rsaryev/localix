import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import type { DockerImage, DockerNetwork, DockerVolume } from '../../backend/contracts'

/**
 * Open (or focus) a container's details + logs center tab. This feature owns the
 * `devops:docker-container` WorkItemKind + its tab-id formula, so re-opening the same
 * container focuses the existing tab. Routed through the generic
 * `miniAppWorkspace.openWorkItem` seam — core names no subsystem.
 *
 * A session kind, opened IN the chat it was asked from: its Exec spawns a shell in that chat's
 * terminal, and a container tab that belonged to no chat opened that shell in whichever chat was
 * on screen.
 */
export function openDockerContainerTab(sessionId: string, containerId: string, name: string): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'devops:docker-container',
    id: `devops:docker-container:${containerId}`,
    title: name,
    scope: sessionId,
    payload: { containerId, name },
  })
}

export type DockerResourceTabInput =
  | { kind: 'image'; resource: DockerImage }
  | { kind: 'volume'; resource: DockerVolume }
  | { kind: 'network'; resource: DockerNetwork }

export const dockerContainerUri = (id: string): string => localixResourceUri('docker', [id])
export const dockerEntityUri = (kind: DockerResourceTabInput['kind'], id: string): string =>
  localixResourceUri('docker', [kind, id])

export function dockerResourceUri(input: DockerResourceTabInput): string {
  if (input.kind === 'image') return dockerEntityUri('image', input.resource.id)
  if (input.kind === 'volume') return dockerEntityUri('volume', input.resource.name)
  return dockerEntityUri('network', input.resource.id)
}

export function dockerResourceLabel(input: DockerResourceTabInput): string {
  if (input.kind === 'image') {
    const tag =
      input.resource.tag && input.resource.tag !== '<none>' ? `:${input.resource.tag}` : ''
    return `${input.resource.repository}${tag}`
  }
  return input.resource.name
}

/**
 * Open or focus a Docker image, volume, or network detail tab. App-level (`scope: null`): the
 * daemon's objects belong to the machine, and the tab acts for no chat — no terminal, no composer.
 */
export function openDockerResourceTab(input: DockerResourceTabInput): void {
  const uri = dockerResourceUri(input)
  miniAppWorkspace.openWorkItem({
    workKind: 'devops:docker-resource',
    id: `devops:docker-resource:${uri}`,
    title: dockerResourceLabel(input),
    scope: null,
    payload: {
      resourceKind: input.kind,
      resourceIdentity:
        input.kind === 'image'
          ? input.resource.id
          : input.kind === 'volume'
            ? input.resource.name
            : input.resource.id,
      resource: input.resource,
      uri,
    },
  })
}
