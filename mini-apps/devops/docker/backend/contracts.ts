import { z } from 'zod'
import type { Prerequisite } from '@localixai/mini-app-sdk/prerequisite'

/**
 * Docker workbench contracts — the engine-agnostic shapes the routes + UI share.
 *
 * A `ContainerEngineBackend` (see `backend.ts`) produces these from either structured Engine API
 * responses or the CLI fallback. Keeping the shapes here (not in the driver) means the UI never
 * learns which transport produced them.
 */

/** Docker's canonical container lifecycle states — the single source the type, the
 *  zod schema, and the parser's normalisation all derive from. */
export const CONTAINER_STATES = [
  'created',
  'restarting',
  'running',
  'removing',
  'paused',
  'exited',
  'dead',
] as const

/** A container's lifecycle state, normalised to Docker's canonical set. */
export type ContainerState = (typeof CONTAINER_STATES)[number]

/**
 * `localix://resource/docker` URI tokens, shared by the backend resource provider and the UI's
 * UI-anchor activation so the reserved-word sets can never drift apart.
 *
 * Category folders are single-segment roots (`localix://resource/docker/containers`, …); entity
 * prefixes disambiguate `localix://resource/docker/image/<id>` etc. from a bare container id (which
 * is hex, never one of these words).
 */
export const DOCKER_CATEGORIES = ['containers', 'images', 'volumes', 'networks'] as const
export type DockerCategory = (typeof DOCKER_CATEGORIES)[number]
export const DOCKER_ENTITY_PREFIXES = ['image', 'volume', 'network'] as const
export type DockerEntityPrefix = (typeof DOCKER_ENTITY_PREFIXES)[number]

/** One row of `docker ps -a`. Ports/labels kept as flat display strings — the UI
 *  renders them verbatim, no per-engine structure leaks out. */
export interface DockerContainer {
  id: string
  /** Primary display name (leading `/` trimmed). */
  name: string
  image: string
  state: ContainerState
  /** Human status line, e.g. `Up 3 hours` / `Exited (0) 2 minutes ago`. */
  status: string
  /** Published ports display, e.g. `0.0.0.0:5432->5432/tcp`. */
  ports: string
  createdAt: string
  /** Docker Compose project name (`com.docker.compose.project` label), if any. */
  project?: string
  /** Docker Compose service name (`com.docker.compose.service` label), if any. */
  service?: string
}

/** One row of `docker images`. */
export interface DockerImage {
  id: string
  repository: string
  tag: string
  /** Human size, e.g. `142MB`. */
  size: string
  /** The same size in bytes, for sorting — absent when the engine reported none we can read. */
  sizeBytes?: number
  createdAt: string
}

/** A container's logs (tail N), returned as one text blob the UI shows in a pre. */
export interface ContainerLogs {
  id: string
  lines: string
}

/** A single live-stats sample for one container. CPU/memory percentages are numeric so
 *  both transports expose the same graphable values: the CLI backend parses `docker stats`,
 *  while the API backend derives them from CPU deltas and memory usage/limit. Usage and I/O
 *  strings retain Docker's human-readable display form (`12MiB / 2GiB`). */
export interface ContainerStats {
  id: string
  /** CPU percent, e.g. `0.15` for `0.15%`. */
  cpuPct: number
  /** Memory percent, e.g. `1.2` for `1.2%`. */
  memPct: number
  /** Memory usage display, e.g. `12MiB / 2GiB`. */
  memUsage: string
  /** Network I/O display, e.g. `1.2kB / 0B`. */
  netIO: string
  /** Block I/O display, e.g. `0B / 0B`. */
  blockIO: string
  /**
   * The same counters as numbers, for deriving throughput between two samples.
   *
   * `null` means Docker REPORTED NOTHING, which is not zero: a `--network host` container,
   * a Windows container, and a rootless/cgroup-v2 host with no blkio accounting all print
   * `--`. Showing that as `0B` would falsely claim that there was no traffic, so the UI
   * preserves the unavailable state separately.
   *
   * Cumulative since the container started, so only DIFFERENCES between samples are
   * meaningful — the absolute value only ever rises.
   */
  netRxBytes: number | null
  netTxBytes: number | null
  blockReadBytes: number | null
  blockWriteBytes: number | null
  /** Number of processes/threads. */
  pids: number
}

/** The process table from `docker top` — headers plus one string cell per column. */
export interface ContainerTop {
  headers: string[]
  processes: string[][]
}

/** One row of `docker volume ls`. */
export interface DockerVolume {
  name: string
  driver: string
  scope: string
}

/** One row of `docker network ls`. */
export interface DockerNetwork {
  id: string
  name: string
  driver: string
  scope: string
}

/** Bulk-prune targets — each maps to `docker <target> prune -f`. */
export type PruneTarget = 'containers' | 'images' | 'volumes' | 'networks'

/** Result of a bulk prune — the raw CLI summary (reclaimed space etc.) shown verbatim. */
export interface PruneResult {
  target: PruneTarget
  output: string
}

export const pruneTargetSchema = z.enum(['containers', 'images', 'volumes', 'networks'])

export const removeQuerySchema = z.object({
  /** Force-remove a running container (`docker rm -f`). Arrives as a query STRING
   *  (`?force=true|false`), so a plain `z.boolean()` would reject every request —
   *  `z.stringbool()` parses the string form. */
  force: z.stringbool().optional(),
})

export const logsQuerySchema = z.object({
  /** How many trailing log lines to fetch (default 200). */
  tail: z.coerce.number().int().min(1).max(5000).optional(),
  /** Incremental polling window. Requests overlap so the client can de-duplicate
   * the boundary without losing lines between ticks. */
  sinceSeconds: z.coerce.number().int().min(1).max(300).optional(),
})

export interface ContainersResponse {
  containers: DockerContainer[]
}
export interface ImagesResponse {
  images: DockerImage[]
}
export interface VolumesResponse {
  volumes: DockerVolume[]
}
export interface NetworksResponse {
  networks: DockerNetwork[]
}
/** Whether the `docker compose` CLI mini app is available (drives the project Up action). */
export interface ComposeAvailableResponse {
  available: boolean
}

/** The typed error body every docker route returns on failure. */
export interface DockerErrorResponse {
  error: string
  code: string
  detail?: string
  /** Present when the engine is absent or stopped — the UI offers Install / Start from it. */
  prerequisite?: Prerequisite
}
