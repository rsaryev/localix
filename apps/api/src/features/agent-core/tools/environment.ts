import path from 'node:path'
import { localixWorkspaceDir } from '../../../lib/env'
import type { DetachedChild } from './environments/spawn'

export type BackendKind = 'local' | 'docker' | 'ssh'

/**
 * Resolve a tool's working directory: an absolute `cwd` as-is, a relative one
 * against `defaultCwd` (the session's resolved workspace —
 * one is enabled), else `defaultCwd`. The single source of truth shared by EVERY
 * cwd-taking tool (bash single/batch/foreground/background AND search) so a
 * relative `cwd` can never resolve differently between them (e.g. land outside
 * the workspace root for one tool but not another).
 *
 * With no `defaultCwd` the base is `~/.localix/workspace`, never the API's launch directory:
 * that is the host application itself (the checkout in dev, the install dir when packaged),
 * and a call that named no directory must not start out inside it.
 */
export function resolveToolCwd(cwd: string | undefined, defaultCwd?: string): string {
  const base = defaultCwd ?? localixWorkspaceDir()
  return cwd ? (path.isAbsolute(cwd) ? cwd : path.resolve(base, cwd)) : base
}

/**
 * POSIX single-quote wrapping: makes an arbitrary string safe as ONE shell word. Shell-arg
 * escaping for the file/search/patch tools and the ssh/docker backends — a divergent copy is a
 * command-injection risk, so the implementation lives once in the plugin SDK (shared with plugin
 * backends and the browser) and this module only re-exports it for the server side.
 */
export { shellQuote } from '@localixai/plugin-sdk/backend'

export interface ExecutionEnvironmentConfig {
  kind: BackendKind
  // Docker
  containerName?: string
  // SSH
  sshHost?: string // user@host
  sshPort?: number // default 22
}

/**
 * Interpret a ripgrep invocation by exit code so callers can distinguish the
 * three outcomes ripgrep collapses into "empty output":
 *   0 → matches (return stdout)   1 → no matches (return '')   2+/-1 → real error (throw)
 * This is what lets the search tool report "no matches" vs a broken regex vs "rg missing".
 *
 * Exit 2 is partial-failure, NOT all-or-nothing: rg still streams the matches it
 * DID find to stdout while one unreadable path (macOS-protected dirs like
 * ~/Library/Caches/*, root-owned files) trips a non-fatal error to stderr. When
 * stdout has results, return them rather than throwing away a whole search for a
 * single inaccessible subdir; only a genuinely empty exit-2 (bad regex, missing
 * rg, unreadable root) is surfaced as an error — with its stderr reason intact.
 */
export function interpretRipgrep(result: {
  stdout: string
  stderr: string
  exitCode: number
}): string {
  if (result.exitCode === 0) return result.stdout
  if (result.exitCode === 1) return ''
  if (result.stdout.trim()) return result.stdout
  const message = result.stderr.trim() || `ripgrep failed (exit code ${result.exitCode})`
  throw new Error(message)
}

/** Options for {@link ExecutionEnvironment.searchFiles}. */
export interface SearchFilesOptions {
  /** Ripgrep glob restricting which files are searched. */
  glob?: string
  /** Lines of context printed around each match (ripgrep `-C`). 0/undefined = none. */
  context?: number
  signal?: AbortSignal
  /**
   * Wall-clock cap in SECONDS, matching `spawnToResult`'s own unit. Absent = no cap.
   *
   * `search` used to pass none, so `search {glob:'**', cwd:'/'}` — an absolute cwd is honoured by
   * `resolveToolCwd` — walked the whole filesystem with only the user's Stop button as a brake, and the
   * self-widening retry could run it three more times in the same call. Cancellation was already wired;
   * it was the ceiling that was missing.
   */
  timeoutSeconds?: number
}

export interface ExecutionEnvironment {
  readonly config: ExecutionEnvironmentConfig
  /** Read a file. Returns text content or throws. `signal` aborts a large read when
   *  the turn is cancelled (mirrors exec/searchFiles), so a huge file stops loading
   *  instead of reading to completion after the run is torn down. */
  readFile(path: string, signal?: AbortSignal): Promise<string>
  /** Write full content to a file. Creates parent dirs if needed. */
  writeFile(path: string, content: string): Promise<void>
  /** Run a shell command. Returns { stdout, stderr, exitCode }. `uncapped` keeps the
   *  FULL stdout (the default tail-caps at ~2 MB) — needed for reads that must round-trip
   *  intact, e.g. base64 of a binary. `pathPrefix` dirs are PREPENDED to PATH
   *  (e.g. enabled plugins' `bin/`) — local
   *  backend only; remote backends run far-side and ignore local paths. */
  exec(
    command: string,
    opts?: {
      cwd?: string
      timeout?: number
      uncapped?: boolean
      signal?: AbortSignal
      pathPrefix?: string[]
      /**
       * Ask for the timed-out child to be handed back alive instead of killed, so a
       * caller can promote a slow command to a background job. ADVISORY: only a
       * backend that owns a local process can honour it. ssh/docker run the command
       * far-side, where there is no child to adopt, so they ignore this and time out
       * as usual — an absent `detached` in the result means "not detached", and the
       * caller keeps its ordinary timeout handling.
       */
      onTimeout?: 'kill' | 'detach'
    },
  ): Promise<{
    stdout: string
    stderr: string
    exitCode: number
    /** Present only when `onTimeout: 'detach'` was honoured; see {@link DetachedChild}. */
    detached?: DetachedChild
  }>
  /** Search with ripgrep. Returns raw output string. `signal` aborts a long search
   *  when the turn is cancelled (mirrors exec's signal). */
  searchFiles(pattern: string, cwd: string, opts?: SearchFilesOptions): Promise<string>
}
