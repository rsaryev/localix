import type {
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from '../../backend/contracts'
import { DockerApiError } from '../dockerApi'
import type { DevOpsIssue } from '../../../ui/DevOpsProblem'
import { dockerIssue } from './dockerIssue'
import { stableList } from '../../../ui/model/stableList'

export type DockerCollection = 'containers' | 'images' | 'volumes' | 'networks'

export interface DockerSnapshot {
  containers: DockerContainer[]
  images: DockerImage[]
  volumes: DockerVolume[]
  networks: DockerNetwork[]
}

export const EMPTY_DOCKER_SNAPSHOT: DockerSnapshot = {
  containers: [],
  images: [],
  volumes: [],
  networks: [],
}

const DOCKER_COLLECTIONS = ['containers', 'images', 'volumes', 'networks'] as const
const DOCKER_SECONDARY_COLLECTIONS = ['images', 'volumes', 'networks'] as const

export const DOCKER_SECONDARY_POLL_MS = 20_000
export const DOCKER_RECOVERY_POLL_MS = 8_000

/** Healthy event coverage needs no timer; failed reads or a lost stream retain recovery polling. */
export function dockerPollIntervalMs(live: boolean, pollMs: number): number | null {
  return live ? null : pollMs
}

/** What an event re-reads: a container's own list, or everything for the other collections. */
export function dockerEventScope(type: 'container' | 'image' | 'volume' | 'network') {
  return type === 'container' ? ('containers' as const) : ('all' as const)
}

/**
 * Containers use the fast cadence. Secondary collections use a slower safety
 * cadence, shortened while one of them is stale so partial failures recover
 * without waiting the full healthy interval. While the events stream is `live`
 * every tick is the rare backstop, so it reads everything.
 */
export function dockerInventoryPollScope(
  lastFullRefreshAt: number,
  now: number,
  resourceErrors: Partial<Record<DockerCollection, DevOpsIssue>> = {},
  live = false,
): 'all' | 'containers' {
  if (live) return 'all'
  const recovering = DOCKER_SECONDARY_COLLECTIONS.some((collection) => resourceErrors[collection])
  const interval = recovering ? DOCKER_RECOVERY_POLL_MS : DOCKER_SECONDARY_POLL_MS
  return lastFullRefreshAt === 0 || now - lastFullRefreshAt >= interval ? 'all' : 'containers'
}

export function mergeDockerInventory(
  previous: DockerSnapshot,
  results: readonly [
    PromiseSettledResult<DockerContainer[]>,
    PromiseSettledResult<DockerImage[]>,
    PromiseSettledResult<DockerVolume[]>,
    PromiseSettledResult<DockerNetwork[]>,
  ],
): {
  snapshot: DockerSnapshot
  resourceErrors: Partial<Record<DockerCollection, DevOpsIssue>>
  successCount: number
  unavailable: boolean
  error: DevOpsIssue | null
} {
  const snapshot = { ...previous }
  const resourceErrors: Partial<Record<DockerCollection, DevOpsIssue>> = {}
  let successCount = 0
  let engineUnavailableCount = 0

  results.forEach((result, index) => {
    const collection = DOCKER_COLLECTIONS[index]!
    if (result.status === 'fulfilled') {
      successCount += 1
      // Reuse the on-screen rows when the daemon reported the same ones: a fresh
      // array identity here would re-render every row on every poll tick. The cast
      // pairs each index with its own row type, which the tuple already guarantees.
      Object.assign(snapshot, {
        [collection]: stableList(
          previous[collection] as readonly unknown[],
          result.value as readonly unknown[],
        ),
      })
      return
    }
    resourceErrors[collection] = dockerIssue(result.reason)
    if (result.reason instanceof DockerApiError && result.reason.code === 'engine_unavailable') {
      engineUnavailableCount += 1
    }
  })

  const allFailed = successCount === 0
  const unavailable = allFailed && engineUnavailableCount === DOCKER_COLLECTIONS.length
  // An absent engine is a failure too, and it is the one that carries the way out (Install / Start
  // Docker): it used to be nulled here and drawn as a separate calm notice that never reached the
  // Event Center and offered only Retry.
  const error = allFailed
    ? (DOCKER_COLLECTIONS.map((collection) => resourceErrors[collection]).find(Boolean) ?? {
        message: 'Could not reach Docker.',
      })
    : null
  return { snapshot, resourceErrors, successCount, unavailable, error }
}
