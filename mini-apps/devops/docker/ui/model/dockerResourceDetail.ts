import type { DockerImage, DockerNetwork, DockerVolume } from '../../backend/contracts'

export type DockerResourceDetail =
  | { kind: 'image'; resource: DockerImage }
  | { kind: 'volume'; resource: DockerVolume }
  | { kind: 'network'; resource: DockerNetwork }

export interface DockerResourceField {
  label: string
  value: string
}

export function dockerResourceDetailMatches(
  detail: DockerResourceDetail | undefined,
  kind: DockerResourceDetail['kind'],
  identity: string,
): boolean {
  if (!detail || detail.kind !== kind) return false
  if (detail.kind === 'volume') return detail.resource.name === identity
  return detail.resource.id === identity
}

export function dockerResourceNeedsInitialLoad(
  active: boolean,
  loadedTarget: string,
  targetKey: string,
  detail: DockerResourceDetail | null,
): boolean {
  return active && loadedTarget !== targetKey && !detail
}

export function dockerResourceLabel(detail: DockerResourceDetail): string {
  if (detail.kind === 'image') {
    const tag =
      detail.resource.tag && detail.resource.tag !== '<none>' ? `:${detail.resource.tag}` : ''
    return `${detail.resource.repository}${tag}`
  }
  return detail.resource.name
}

export function dockerResourceFields(detail: DockerResourceDetail): DockerResourceField[] {
  if (detail.kind === 'image') {
    return [
      { label: 'Repository', value: detail.resource.repository },
      { label: 'Tag', value: detail.resource.tag || '—' },
      { label: 'Image ID', value: detail.resource.id },
      { label: 'Size', value: detail.resource.size },
      { label: 'Created', value: detail.resource.createdAt },
    ]
  }
  if (detail.kind === 'volume') {
    return [
      { label: 'Name', value: detail.resource.name },
      { label: 'Driver', value: detail.resource.driver },
      { label: 'Scope', value: detail.resource.scope },
    ]
  }
  return [
    { label: 'Name', value: detail.resource.name },
    { label: 'Network ID', value: detail.resource.id },
    { label: 'Driver', value: detail.resource.driver },
    { label: 'Scope', value: detail.resource.scope },
  ]
}
