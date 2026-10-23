/**
 * Map Docker Engine API payloads onto the workbench's contracts.
 *
 * The API and the CLI disagree about shape in three ways that matter, so this is a real
 * translation rather than a rename:
 *
 *  - `Ports` is a structured array, where `docker ps` prints a grouped, sorted display
 *    string. That mapping lives in `api-ports.ts`.
 *  - `Created` is a Unix timestamp; `docker ps` prints a formatted local date.
 *  - `Labels` is a genuine object. This is a CORRECTNESS WIN over the CLI path, not just a
 *    convenience: `parse.ts` has to guess at label boundaries because the CLI joins labels
 *    with commas AND compose writes comma-joined path lists into
 *    `com.docker.compose.project.config_files`, making the two indistinguishable. Over the API
 *    there is no ambiguity to guess at.
 */
import { formatDecimalSize } from './bytes'
import type {
  ContainerTop,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from './contracts'
import { normalizeState } from './parse'
import { type ApiPort, formatApiPorts } from './api-ports'

interface ApiContainer {
  Id?: string
  Names?: string[]
  Image?: string
  State?: string
  Status?: string
  Created?: number
  Ports?: ApiPort[]
  Labels?: Record<string, string>
}

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project'
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service'

const string = (value: unknown): string => (typeof value === 'string' ? value : '')
const finiteNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

function createdAt(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : ''
}

/** Docker prefixes container names with `/`; the first name is the display one. */
function primaryName(names: string[] | undefined): string {
  const first = string(names?.[0]).trim()
  return first.startsWith('/') ? first.slice(1) : first
}

/**
 * One `/containers/json` entry as a workbench row.
 *
 * `Created` is seconds since the epoch; the contract carries a string the UI derives a
 * relative age from, so it becomes ISO rather than a locale-formatted date — unlike the CLI's
 * `2026-07-28 11:50:28 +0300 EEST`, which is unparseable without knowing the zone abbreviation.
 */
export function containerFromApi(raw: unknown): DockerContainer | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as ApiContainer
  const id = string(entry.Id)
  if (!id) return null
  const labels = entry.Labels ?? {}
  const project = string(labels[COMPOSE_PROJECT_LABEL]).trim()
  const service = string(labels[COMPOSE_SERVICE_LABEL]).trim()
  return {
    id,
    name: primaryName(entry.Names),
    image: string(entry.Image),
    // Reuses the CLI path's normaliser so an unknown state maps identically on both paths.
    state: normalizeState(string(entry.State)),
    status: string(entry.Status),
    ports: formatApiPorts(entry.Ports),
    createdAt: createdAt(entry.Created),
    ...(project ? { project } : {}),
    ...(service ? { service } : {}),
  }
}

/** A `/containers/json` response as workbench rows, skipping anything unusable. */
export function containersFromApi(raw: unknown): DockerContainer[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => containerFromApi(entry) ?? [])
}

interface ApiImage {
  Id?: string
  RepoTags?: string[]
  Size?: number
  Created?: number
}

function splitImageTag(reference: string): { repository: string; tag: string } {
  const slash = reference.lastIndexOf('/')
  const colon = reference.lastIndexOf(':')
  return colon > slash
    ? { repository: reference.slice(0, colon), tag: reference.slice(colon + 1) }
    : { repository: reference, tag: '<none>' }
}

/** `/images/json` returns one image with zero or more tags; the CLI renders one row per tag. */
export function imagesFromApi(raw: unknown): DockerImage[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const image = value as ApiImage
    const id = string(image.Id)
    if (!id) return []
    const references = image.RepoTags?.filter((tag): tag is string => typeof tag === 'string') ?? []
    const tags = references.length ? references : ['<none>:<none>']
    return tags.map((reference) => ({
      id,
      ...splitImageTag(reference),
      size: formatDecimalSize(finiteNumber(image.Size)),
      sizeBytes: finiteNumber(image.Size),
      createdAt: createdAt(image.Created),
    }))
  })
}

interface ApiVolume {
  Name?: string
  Driver?: string
  Scope?: string
}

/** `/volumes` wraps its rows in a `Volumes` property. */
export function volumesFromApi(raw: unknown): DockerVolume[] {
  if (!raw || typeof raw !== 'object') return []
  const volumes = (raw as { Volumes?: unknown }).Volumes
  if (!Array.isArray(volumes)) return []
  return volumes.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const volume = value as ApiVolume
    const name = string(volume.Name)
    return name ? [{ name, driver: string(volume.Driver), scope: string(volume.Scope) }] : []
  })
}

interface ApiNetwork {
  Id?: string
  Name?: string
  Driver?: string
  Scope?: string
}

/** Map `/networks` rows, dropping entries that cannot be addressed again. */
export function networksFromApi(raw: unknown): DockerNetwork[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const network = value as ApiNetwork
    const id = string(network.Id)
    return id
      ? [
          {
            id,
            name: string(network.Name),
            driver: string(network.Driver),
            scope: string(network.Scope),
          },
        ]
      : []
  })
}

/** The Engine already returns the process table in the port's exact shape. */
export function topFromApi(raw: unknown): ContainerTop {
  if (!raw || typeof raw !== 'object') return { headers: [], processes: [] }
  const top = raw as { Titles?: unknown; Processes?: unknown }
  const headers = Array.isArray(top.Titles)
    ? top.Titles.filter((value): value is string => typeof value === 'string')
    : []
  const processes = Array.isArray(top.Processes)
    ? top.Processes.flatMap((row) =>
        Array.isArray(row) && row.every((value) => typeof value === 'string') ? [row] : [],
      )
    : []
  return { headers, processes }
}
