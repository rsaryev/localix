import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { normalizeResourceSort, type ResourceSort } from '../../../ui/model/resourceSort'

const DOCKER_VIEW_KEY = 'localix.devops.containers.view'

export type DockerResourceView = 'containers' | 'images' | 'volumes' | 'networks'
export type DockerSortKey = 'name' | 'state' | 'image' | 'created' | 'size' | 'driver' | 'scope'
export type DockerSortState = Record<DockerResourceView, ResourceSort<DockerSortKey>>

export const DOCKER_SORT_OPTIONS = {
  containers: [
    { value: 'name', label: 'Name' },
    { value: 'state', label: 'State' },
    { value: 'image', label: 'Image' },
    { value: 'created', label: 'Created' },
  ],
  images: [
    { value: 'name', label: 'Repository' },
    { value: 'size', label: 'Size' },
    { value: 'created', label: 'Created' },
  ],
  volumes: [
    { value: 'name', label: 'Name' },
    { value: 'driver', label: 'Driver' },
    { value: 'scope', label: 'Scope' },
  ],
  networks: [
    { value: 'name', label: 'Name' },
    { value: 'driver', label: 'Driver' },
    { value: 'scope', label: 'Scope' },
  ],
} as const satisfies Record<DockerResourceView, readonly { value: DockerSortKey; label: string }[]>

const DEFAULT_DOCKER_SORT = {
  containers: { key: 'name', direction: 'asc' },
  images: { key: 'name', direction: 'asc' },
  volumes: { key: 'name', direction: 'asc' },
  networks: { key: 'name', direction: 'asc' },
} as const satisfies DockerSortState

export interface DockerViewState {
  filter: string
  resource: DockerResourceView
  sort: DockerSortState
}

const RESOURCES = new Set<DockerResourceView>(['containers', 'images', 'volumes', 'networks'])

export function normalizeDockerView(raw: unknown): DockerViewState {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const storedSort =
    value.sort && typeof value.sort === 'object' ? (value.sort as Record<string, unknown>) : {}
  return {
    filter: typeof value.filter === 'string' ? value.filter : '',
    resource:
      typeof value.resource === 'string' && RESOURCES.has(value.resource as DockerResourceView)
        ? (value.resource as DockerResourceView)
        : 'containers',
    sort: {
      containers: normalizeResourceSort(
        storedSort.containers,
        DOCKER_SORT_OPTIONS.containers.map((option) => option.value),
        DEFAULT_DOCKER_SORT.containers,
      ),
      images: normalizeResourceSort(
        storedSort.images,
        DOCKER_SORT_OPTIONS.images.map((option) => option.value),
        DEFAULT_DOCKER_SORT.images,
      ),
      volumes: normalizeResourceSort(
        storedSort.volumes,
        DOCKER_SORT_OPTIONS.volumes.map((option) => option.value),
        DEFAULT_DOCKER_SORT.volumes,
      ),
      networks: normalizeResourceSort(
        storedSort.networks,
        DOCKER_SORT_OPTIONS.networks.map((option) => option.value),
        DEFAULT_DOCKER_SORT.networks,
      ),
    },
  }
}

export function loadDockerView(): DockerViewState {
  return normalizeDockerView(loadJSON<unknown>(DOCKER_VIEW_KEY))
}

export function saveDockerView(view: DockerViewState): void {
  saveJSON(DOCKER_VIEW_KEY, view)
}
