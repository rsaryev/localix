/**
 * Nested-repository discovery. Given a container directory (a project working
 * dir that may hold many independent git repos side by side), find every git
 * repository under it — a bounded-depth breadth-first walk that stops at each
 * repo boundary so it never scans a repo's full working tree.
 *
 * VCS-neutral in spirit but keyed on `.git` (the only backend today). Pure walk
 * over an injectable directory reader so it unit-tests without a real FS.
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'

/** One directory entry the walk needs: a name and whether it's a directory. */
export interface DirEntry {
  name: string
  isDirectory: boolean
}

/** Reads the immediate children of a directory. Injected so the walk is testable. */
export type ReadEntries = (dir: string) => Promise<DirEntry[]>

export interface DiscoverOptions {
  /** How many directory levels below the root to descend (root = 0). */
  maxDepth?: number
  /** Hard cap on repos returned — a runaway backstop, not a real limit. */
  maxRepos?: number
  /** Directory names never descended into (heavy/build/dependency trees). */
  skipDirs?: ReadonlySet<string>
  /** Injectable directory reader (defaults to `fs.readdir`). */
  readEntries?: ReadEntries
}

/** Build/dependency dirs that never hold a project repo worth surfacing. */
export const DEFAULT_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage',
])

const DEFAULT_MAX_DEPTH = 4
const DEFAULT_MAX_REPOS = 200

/** Default reader: real filesystem, tolerant of unreadable dirs. */
const fsReadEntries: ReadEntries = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
}

/** A `.git` entry (dir OR file — worktrees/submodules use a `.git` file) marks a repo root. */
const hasGitEntry = (entries: DirEntry[]): boolean => entries.some((e) => e.name === '.git')

/**
 * Discover git repositories under `rootDir`, returning absolute repo roots
 * (sorted). A found repo is a boundary — recorded and NOT descended into, so a
 * repo's own working tree is never walked. The intended shape is a container
 * holding many sibling repos; independent repos nested INSIDE a discovered repo
 * are not surfaced (treat those as submodules). The ONE exception is the scan
 * ROOT: it may itself be a repo that also acts as such a container (e.g. sibling
 * clones under a gitignored dir), so the walk descends through the root even when
 * it is a repo — bounded by maxDepth/skipDirs. Dot-dirs and the skip list are
 * never entered.
 */
export async function discoverRepos(
  rootDir: string,
  opts: DiscoverOptions = {},
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxRepos = opts.maxRepos ?? DEFAULT_MAX_REPOS
  const skip = opts.skipDirs ?? DEFAULT_SKIP_DIRS
  const read = opts.readEntries ?? fsReadEntries

  const found: string[] = []
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }]

  while (queue.length > 0 && found.length < maxRepos) {
    const { dir, depth } = queue.shift()!
    let entries: DirEntry[]
    try {
      entries = await read(dir)
    } catch {
      continue // unreadable dir — skip, never fatal
    }

    const isRepo = hasGitEntry(entries)
    if (isRepo) {
      found.push(dir)
      // A repo is normally a boundary — its working tree is never walked, so an
      // independent repo nested inside another is treated as a submodule and not
      // surfaced. EXCEPTION: the scan ROOT itself may be a repo that ALSO serves
      // as a container for sibling clones checked out beneath it (commonly under a
      // gitignored dir — e.g. a `vendor/`/`workspace/` holding many independent
      // repos, where the outer repo can't track them). Keep descending THROUGH the
      // root (still bounded by maxDepth + skipDirs + maxRepos) so those nested
      // repos are surfaced; any repo found BELOW the root stays a boundary.
      if (depth > 0) continue
    }

    if (depth >= maxDepth) continue

    for (const entry of entries) {
      if (!entry.isDirectory) continue
      if (entry.name.startsWith('.')) continue // .git, .cache, .next, …
      if (skip.has(entry.name)) continue
      queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 })
    }
  }

  return found.sort()
}
