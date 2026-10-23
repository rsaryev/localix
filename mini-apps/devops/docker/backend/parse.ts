import { parseDockerBytePair, parseDockerBytes } from './bytes'
import type {
  ContainerState,
  ContainerStats,
  ContainerTop,
  DockerContainer,
  DockerImage,
  DockerNetwork,
  DockerVolume,
} from './contracts'
import { CONTAINER_STATES } from './contracts'
import { str } from '../../backend/coerce'

/**
 * Pure parsers for the `docker … --format '{{json .}}'` line-delimited output.
 *
 * The CLI prints one JSON object per line (NOT a JSON array), so we split on
 * newlines and parse each line independently — a malformed line is skipped rather
 * than failing the whole listing. Kept free of any I/O so they are unit-testable.
 */

/** Normalise Docker's `State` field to our canonical set; unknown → `exited`. */
export function normalizeState(raw: string | undefined): ContainerState {
  const s = (raw ?? '').trim().toLowerCase()
  return (CONTAINER_STATES as readonly string[]).includes(s) ? (s as ContainerState) : 'exited'
}

/**
 * Derive a container state from its human `Status` string — the fallback for Docker
 * &lt;20.10 whose `ps --format` output omits the `.State` field. Tested in a DELIBERATE
 * order: `(Paused)` is matched BEFORE `Up`, because a paused container's status reads
 * `Up 3 hours (Paused)`.
 */
export function deriveStateFromStatus(status: string): ContainerState {
  const s = (status ?? '').trim()
  if (s.includes('(Paused)')) return 'paused'
  if (s.startsWith('Restarting')) return 'restarting'
  if (s.startsWith('Created')) return 'created'
  if (s.startsWith('Removal') || s.startsWith('Removing')) return 'removing'
  if (s.startsWith('Dead')) return 'dead'
  if (s.startsWith('Up')) return 'running'
  return 'exited'
}

/** Trim a single leading `/` Docker prefixes onto container names. */
function trimName(name: string | undefined): string {
  const n = (name ?? '').split(',')[0]?.trim() ?? ''
  return n.startsWith('/') ? n.slice(1) : n
}

function eachJsonLine(stdout: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      if (obj && typeof obj === 'object') rows.push(obj as Record<string, unknown>)
    } catch {
      // Skip a malformed line rather than dropping the whole listing.
    }
  }
  return rows
}

/**
 * Parse Docker's flat `Labels` string (`"k1=v1,k2=v2"`) into a map.
 *
 * The CLI joins labels with commas — but a label VALUE can ALSO contain commas: compose
 * stamps `com.docker.compose.project.config_files` as a comma-joined path list. In the
 * flat string those are indistinguishable, so a segment WITHOUT an `=` is treated as a
 * continuation of the preceding value's comma-list rather than dropped. Dropping it (the
 * old behaviour) silently truncated a multi-file compose project to its first config file,
 * which then reached `composeUp` as an incomplete `-f` set. (A `=` inside a continuation
 * segment — e.g. a path containing `=` — is still ambiguous and would start a new pair;
 * that is inherent to Docker's un-escaped format and vanishingly rare for real paths.)
 */
export function parseLabels(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  let lastKey: string | null = null
  for (const pair of str(raw).split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) {
      if (lastKey !== null && pair) out[lastKey] += `,${pair}`
      continue
    }
    const key = pair.slice(0, eq).trim()
    if (!key) {
      lastKey = null
      continue
    }
    out[key] = pair.slice(eq + 1).trim()
    lastKey = key
  }
  return out
}

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project'
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service'

/** Parse `docker ps -a --format '{{json .}}'`. Compose containers additionally
 *  carry a `project`/`service` derived from the `com.docker.compose.*` labels. */
export function parseContainers(stdout: string): DockerContainer[] {
  return eachJsonLine(stdout).map((r) => {
    const labels = parseLabels(str(r.Labels))
    const project = labels[COMPOSE_PROJECT_LABEL]
    const service = labels[COMPOSE_SERVICE_LABEL]
    const rawState = str(r.State)
    // Modern engines emit `.State`; legacy `ps` output omits it, so recover the state
    // from the `Status` string instead.
    const state = rawState.trim() ? normalizeState(rawState) : deriveStateFromStatus(str(r.Status))
    return {
      id: str(r.ID),
      name: trimName(str(r.Names)),
      image: str(r.Image),
      state,
      status: str(r.Status),
      ports: str(r.Ports),
      createdAt: str(r.CreatedAt),
      ...(project ? { project } : {}),
      ...(service ? { service } : {}),
    }
  })
}

/** Parse `docker images --format '{{json .}}'`. */
export function parseImages(stdout: string): DockerImage[] {
  return eachJsonLine(stdout).map((r) => {
    const sizeBytes = parseDockerBytes(r.Size)
    return {
      id: str(r.ID),
      repository: str(r.Repository),
      tag: str(r.Tag),
      size: str(r.Size),
      ...(sizeBytes === null ? {} : { sizeBytes }),
      createdAt: str(r.CreatedAt),
    }
  })
}

/** Parse a `docker stats`-style percent field (`"0.15%"` → `0.15`; junk → `0`). */
function parsePct(v: unknown): number {
  const n = Number.parseFloat(str(v).replace('%', '').trim())
  return Number.isFinite(n) ? n : 0
}

/** Parse `docker stats --no-stream --format '{{json .}}'`. One object per line;
 *  Docker already computes CPU%/mem% from the raw API deltas, so we take them
 *  verbatim and normalise the numeric fields. */
export function parseStats(stdout: string): ContainerStats[] {
  return eachJsonLine(stdout).map((r) => {
    // Docker's display strings are kept verbatim AND parsed: the strings are what a user
    // recognises from the CLI, the numbers are what a rate can be derived from.
    const [netRxBytes, netTxBytes] = parseDockerBytePair(str(r.NetIO))
    const [blockReadBytes, blockWriteBytes] = parseDockerBytePair(str(r.BlockIO))
    return {
      id: str(r.ID),
      cpuPct: parsePct(r.CPUPerc),
      memPct: parsePct(r.MemPerc),
      memUsage: str(r.MemUsage),
      netIO: str(r.NetIO),
      blockIO: str(r.BlockIO),
      netRxBytes,
      netTxBytes,
      blockReadBytes,
      blockWriteBytes,
      pids: (() => {
        const n = Number.parseInt(str(r.PIDs), 10)
        return Number.isFinite(n) ? n : 0
      })(),
    }
  })
}

/** Parse `docker top <id>` — a `ps`-style table: a header row then one row per
 *  process, whitespace-separated. The final column (CMD) can contain spaces, so we
 *  split each row into `headers.length - 1` leading cells and keep the remainder as
 *  the last cell. A row with fewer cells than headers is padded so columns align. */
export function parseTop(stdout: string): ContainerTop {
  const lines = stdout.split('\n').filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], processes: [] }
  const headers = lines[0]!.trim().split(/\s+/)
  const n = headers.length
  const processes = lines.slice(1).map((line) => {
    const parts = line.trim().split(/\s+/)
    if (n <= 1) return [line.trim()]
    // Keep the first n-1 columns, join the remainder (CMD may contain spaces).
    const cells = parts.slice(0, n - 1)
    cells.push(parts.slice(n - 1).join(' '))
    while (cells.length < n) cells.push('')
    return cells
  })
  return { headers, processes }
}

/** Parse `docker volume ls --format '{{json .}}'`. */
export function parseVolumes(stdout: string): DockerVolume[] {
  return eachJsonLine(stdout).map((r) => ({
    name: str(r.Name),
    driver: str(r.Driver),
    scope: str(r.Scope),
  }))
}

/** Parse `docker network ls --no-trunc --format '{{json .}}'`. */
export function parseNetworks(stdout: string): DockerNetwork[] {
  return eachJsonLine(stdout).map((r) => ({
    id: str(r.ID),
    name: str(r.Name),
    driver: str(r.Driver),
    scope: str(r.Scope),
  }))
}

const COMPOSE_WORKDIR_LABEL = 'com.docker.compose.project.working_dir'
const COMPOSE_CONFIG_FILES_LABEL = 'com.docker.compose.project.config_files'

/** Where a Compose project lives on disk, recovered from its containers' labels. */
export interface ComposeProjectPaths {
  /** Absolute working dir Compose ran from (`com.docker.compose.project.working_dir`). */
  workingDir?: string
  /** Config file paths (`com.docker.compose.project.config_files`), split on comma. */
  configFiles: string[]
}

/**
 * Recover a Compose project's on-disk location from the labels Docker stamps onto
 * each of its containers (all a project's containers carry identical values, so the
 * first labelled row wins). The API process cwd is NOT where the manifest lives, so
 * `composeUp` needs this to run `docker compose` from the right place. Returns null
 * when no container carries either label.
 */
export function parseComposeProjectPaths(stdout: string): ComposeProjectPaths | null {
  for (const r of eachJsonLine(stdout)) {
    const labels = parseLabels(str(r.Labels))
    const workingDir = labels[COMPOSE_WORKDIR_LABEL]
    const configFilesRaw = labels[COMPOSE_CONFIG_FILES_LABEL]
    if (workingDir || configFilesRaw) {
      return {
        ...(workingDir ? { workingDir } : {}),
        configFiles: configFilesRaw
          ? configFilesRaw
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean)
          : [],
      }
    }
  }
  return null
}
