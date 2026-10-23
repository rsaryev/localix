/**
 * Pure builders for the shell commands the Dockerfile / Compose editor Run bar
 * spawns in a terminal. Kept pure + unit-tested so the quoting logic (paths with
 * spaces) is verifiable without a running terminal. Every path/tag is single-quoted
 * with embedded single quotes escaped, so a manifest path with spaces is safe.
 */

import { shellQuote } from '@localixai/mini-app-sdk/ui/utilities'

/** Which kind of Docker manifest a file path is (or null for a plain file). */
export type DockerManifestKind = 'dockerfile' | 'compose'

/** The compose sub-commands the Run bar exposes. */
export type ComposeAction = 'up' | 'down' | 'ps' | 'logs' | 'build'

/** Single-quote a shell argument — the shared primitive, see `@localixai/mini-app-sdk/ui/utilities`. */
const shq = shellQuote

/** The basename of a path (handles both `/` and `\\` separators). */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] ?? path
}

/** The parent directory of a path, or `.` when it has none. */
export function dirName(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx <= 0 ? '.' : path.slice(0, idx)
}

/**
 * Classify a file path as a Docker manifest by basename:
 *  - Dockerfile → `Dockerfile` (any case) or `*.Dockerfile`
 *  - Compose    → `docker-compose.yml|yaml` or `compose.yml|yaml`
 */
export function detectManifestKind(path: string): DockerManifestKind | null {
  const base = baseName(path).toLowerCase()
  if (base === 'dockerfile' || base.endsWith('.dockerfile')) return 'dockerfile'
  if (/^(docker-compose|compose)\.ya?ml$/.test(base)) return 'compose'
  return null
}

/** A sensible default image tag for a Dockerfile: its context directory's name. */
export function defaultBuildTag(path: string): string {
  const dir = dirName(path)
  const name = dir === '.' ? 'app' : baseName(dir)
  // Docker tags must be lowercase; keep it simple and safe.
  return (
    (name || 'app')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'app'
  )
}

/** `docker build -f <path> -t <tag> <contextDir>` — contextDir = the file's parent dir. */
export function buildDockerBuildCommand(path: string, tag: string): string {
  return `docker build -f ${shq(path)} -t ${shq(tag)} ${shq(dirName(path))}`
}

/** `docker compose -f <path> <action…>` for the given compose action. */
export function buildComposeCommand(path: string, action: ComposeAction): string {
  const args: Record<ComposeAction, string> = {
    up: 'up -d',
    down: 'down',
    ps: 'ps',
    logs: 'logs -f',
    build: 'build',
  }
  return `docker compose -f ${shq(path)} ${args[action]}`
}
