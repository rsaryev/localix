import type { ContainerEngineBackend } from './backend'
import { formatDecimalSize } from './bytes'
import type { PruneTarget } from './contracts'
import { mapDockerError } from './errors'
import { readDockerLogs } from './log-stream'
import {
  containersFromApi,
  imagesFromApi,
  networksFromApi,
  topFromApi,
  volumesFromApi,
} from './api-shapes'
import { createStatsReader } from './api-stats'
import {
  DOCKER_ACTION_TIMEOUT_MS,
  DOCKER_STATS_TIMEOUT_MS,
  DockerTransportError,
  type DockerApiClient,
} from './api-transport'
import type { RawStatsSample } from './stats-calc'

interface PruneResponse {
  ContainersDeleted?: unknown[]
  ImagesDeleted?: unknown[]
  VolumesDeleted?: unknown[]
  NetworksDeleted?: unknown[]
  SpaceReclaimed?: number
}

export interface DockerApiBackendOptions {
  client: DockerApiClient
  /** CLI exception for Compose, which has no Engine API. */
  cli: ContainerEngineBackend
  now?: () => number
}

const token = (value: string): string => encodeURIComponent(value)

function deletedCount(target: PruneTarget, result: PruneResponse): number {
  const keys = {
    containers: 'ContainersDeleted',
    images: 'ImagesDeleted',
    volumes: 'VolumesDeleted',
    networks: 'NetworksDeleted',
  } as const
  const deleted = result[keys[target]]
  return Array.isArray(deleted) ? deleted.length : 0
}

function pruneOutput(target: PruneTarget, result: PruneResponse): string {
  const count = deletedCount(target, result)
  const reclaimed = formatDecimalSize(
    typeof result.SpaceReclaimed === 'number' ? result.SpaceReclaimed : 0,
  )
  return `Deleted ${count} ${target}; reclaimed ${reclaimed}.`
}

/**
 * Engine API implementation of the stable container backend port.
 *
 * Core inventory, logs, stats, lifecycle actions and prune calls stay structured end-to-end.
 * Compose remains a deliberate CLI exception because it is a client-side mini app, not an Engine
 * endpoint. SSH and TLS hosts are handled one level up by selecting the complete CLI fallback.
 */
export function createDockerApiBackend(options: DockerApiBackendOptions): ContainerEngineBackend {
  const { client, cli } = options
  const now = options.now ?? Date.now
  const stats = createStatsReader({ windows: client.api.windows })
  const call = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      throw mapDockerError(error)
    }
  }

  return {
    listContainers: () =>
      call(async () => containersFromApi(await client.get('/containers/json?all=1'))),
    listImages: () => call(async () => imagesFromApi(await client.get('/images/json'))),
    listVolumes: () => call(async () => volumesFromApi(await client.get('/volumes'))),
    listNetworks: () => call(async () => networksFromApi(await client.get('/networks'))),
    async containerStats(id) {
      try {
        const oneShot = client.api.oneShotStats ? '&one-shot=true' : ''
        const sample = await client.get<RawStatsSample>(
          `/containers/${token(id)}/stats?stream=false${oneShot}`,
          { timeoutMs: DOCKER_STATS_TIMEOUT_MS },
        )
        return stats.read(id, sample)
      } catch (error) {
        if (
          error instanceof DockerTransportError &&
          error.status === 409 &&
          error.message.toLowerCase().includes('not running')
        ) {
          stats.forget(id)
          return null
        }
        throw mapDockerError(error)
      }
    },
    containerTop: (id) =>
      call(async () => topFromApi(await client.get(`/containers/${token(id)}/top`))),
    async containerLogs(id, tail, sinceSeconds) {
      return call(async () => {
        const query = new URLSearchParams({
          stdout: '1',
          stderr: '1',
          timestamps: '1',
          tail: String(tail),
        })
        if (sinceSeconds) {
          query.set('since', String(Math.max(0, Math.floor(now() / 1000) - sinceSeconds)))
        }
        const response = await client.raw(`/containers/${token(id)}/logs?${query}`)
        return { id, lines: await readDockerLogs(response) }
      })
    },
    startContainer: (id) =>
      call(async () => {
        stats.forget(id)
        await client.post(`/containers/${token(id)}/start`)
      }),
    stopContainer: (id) =>
      call(async () => {
        await client.post(`/containers/${token(id)}/stop`, {
          timeoutMs: DOCKER_ACTION_TIMEOUT_MS,
        })
        stats.forget(id)
      }),
    restartContainer: (id) =>
      call(async () => {
        await client.post(`/containers/${token(id)}/restart`, {
          timeoutMs: DOCKER_ACTION_TIMEOUT_MS,
        })
        stats.forget(id)
      }),
    removeContainer: (id, force) =>
      call(async () => {
        await client.del(`/containers/${token(id)}?force=${force}`)
        stats.forget(id)
      }),
    removeImage: (id, force) => call(async () => client.del(`/images/${token(id)}?force=${force}`)),
    removeVolume: (name, force) =>
      call(async () => client.del(`/volumes/${token(name)}?force=${force}`)),
    removeNetwork: (id) => call(async () => client.del(`/networks/${token(id)}`)),
    prune: (target) =>
      call(async () => {
        // A prune of a large store outlives the 10s request default — the same reason as stop.
        const result =
          (await client.post<PruneResponse>(`/${target}/prune`, {
            timeoutMs: DOCKER_ACTION_TIMEOUT_MS,
          })) ?? {}
        return { target, output: pruneOutput(target, result) }
      }),
    composeAvailable: () => cli.composeAvailable(),
    composeUp: (project) => cli.composeUp(project),
  }
}
