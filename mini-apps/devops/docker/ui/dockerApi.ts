// REST client for the Docker workbench backend (`/rpc/docker`). A missing daemon
// comes back as a typed `{ code: 'engine_unavailable' }` with a 503 — we surface
// that so the sidebar can render an empty state instead of an error toast.
import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui/transport'
import type {
  ComposeAvailableResponse,
  ContainerLogs,
  ContainerStats,
  ContainerTop,
  ContainersResponse,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  ImagesResponse,
  NetworksResponse,
  PruneResult,
  PruneTarget,
  VolumesResponse,
} from '../backend/contracts'
import type { DockerErrorCode } from '../backend/errors'
import { DevOpsApiError, readApiResponse } from '../../ui/apiFailure'

export class DockerApiError extends DevOpsApiError<DockerErrorCode> {
  override readonly name = 'DockerApiError'
}

const readOr = <T>(res: Response, method: string) =>
  readApiResponse<T, DockerErrorCode>(res, method, DockerApiError)

const base = '/rpc/docker'

/** GET a route and parse its typed body. */
const get = async <T>(path: string): Promise<T> =>
  readOr<T>(await miniAppApiFetch(`${base}${path}`), 'GET')

/** POST (or another mutating method) to a route and parse its typed body. */
const send = async <T>(path: string, init: RequestInit = { method: 'POST' }): Promise<T> =>
  readOr<T>(await miniAppApiFetch(`${base}${path}`, init), init.method ?? 'POST')

const enc = encodeURIComponent

export const dockerApi = {
  async listContainers(): Promise<DockerContainer[]> {
    return (await get<ContainersResponse>('/containers')).containers
  },
  async listImages(): Promise<DockerImage[]> {
    return (await get<ImagesResponse>('/images')).images
  },
  async listVolumes(): Promise<DockerVolume[]> {
    return (await get<VolumesResponse>('/volumes')).volumes
  },
  async listNetworks(): Promise<DockerNetwork[]> {
    return (await get<NetworksResponse>('/networks')).networks
  },
  logs: (id: string, tail = 200, sinceSeconds?: number): Promise<ContainerLogs> =>
    get(
      `/containers/${enc(id)}/logs?tail=${tail}${sinceSeconds ? `&sinceSeconds=${sinceSeconds}` : ''}`,
    ),
  async stats(id: string): Promise<ContainerStats | null> {
    return (await get<{ stats: ContainerStats | null }>(`/containers/${enc(id)}/stats`)).stats
  },
  top: (id: string): Promise<ContainerTop> => get(`/containers/${enc(id)}/top`),
  async action(id: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
    await send(`/containers/${enc(id)}/${action}`)
  },
  async remove(id: string, force = false): Promise<void> {
    await send(`/containers/${enc(id)}/remove?force=${force}`)
  },
  async removeImage(id: string, force = false): Promise<void> {
    await send(`/images/${enc(id)}?force=${force}`, { method: 'DELETE' })
  },
  async removeVolume(name: string, force = false): Promise<void> {
    await send(`/volumes/${enc(name)}/remove?force=${force}`)
  },
  async removeNetwork(id: string): Promise<void> {
    await send(`/networks/${enc(id)}/remove`)
  },
  prune: (target: PruneTarget): Promise<PruneResult> =>
    send('/prune', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target }),
    }),
  async composeAvailable(): Promise<boolean> {
    return (await get<ComposeAvailableResponse>('/compose/available')).available
  },
  async composeUp(project: string): Promise<void> {
    await send(`/compose/${enc(project)}/up`)
  },
}
