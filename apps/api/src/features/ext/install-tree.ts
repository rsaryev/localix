import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { isPathBelow } from '../../lib/path-containment'

// Install-tree copy primitive for the plugin installer.
// Both subsystems copy a source extension directory under a managed install root,
// skipping the same VCS/dependency/build cruft — so the allowlist + copy lives here
// (in features/ext) rather than in one feature that the other reaches sideways into.

/**
 * Directory/file names never copied into an installed extension — VCS metadata,
 * dependency trees, and build/editor cruft. Keeps installs lean and avoids dragging
 * a `.env`/`.git` from the source into the install root.
 */
const COPY_IGNORE = new Set([
  // VCS
  '.git',
  '.svn',
  '.hg',
  // dependencies
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  // Python eggs (.eggs dir; .egg-info dirs are suffix-matched below)
  '.eggs',
  // build output
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  // caches and misc tooling
  '.turbo',
  '.cache',
  'coverage',
  '.nyc_output',
  '.tox',
  // editor configs
  '.vscode',
  '.idea',
  '.DS_Store',
  'Thumbs.db',
  // secrets (never copy these into a shared install)
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
])
const COPY_IGNORE_SUFFIXES = ['.egg-info', '.pyc', '.pyo', '.class']

/**
 * Recursively delete a path, swallowing a missing-target (or any) error. The
 * best-effort remover for the plugin installer — temp
 * clones, staging dirs, and abandoned installs are all torn down through this so
 * the swallow-on-failure contract can't drift between call sites.
 */
export const rmrf = (path: string): Promise<void> =>
  fs
    .rm(path, { recursive: true, force: true })
    .then(() => {})
    .catch(() => {})

/** Strip a materialized clone's `.git` so the installed copy is a plain directory. */
export const stripDotGit = (dir: string): Promise<void> => rmrf(join(dir, '.git'))

/**
 * Copy an extension source tree, skipping VCS/dependency/build cruft and
 * following no symlinks (the link is copied, never its possibly out-of-tree target).
 */
export async function copyExtensionTree(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => {
      const base = basename(source)
      return !COPY_IGNORE.has(base) && !COPY_IGNORE_SUFFIXES.some((s) => base.endsWith(s))
    },
  })
}

/**
 * Read an extension manifest file and return its trimmed `name` string, or null
 * when the file is missing/unreadable/malformed or carries no usable name. Shared
 * by the plugin installer, which derives an install name
 * from a manifest's `name` (with a directory-basename fallback the caller owns,
 * since the validity rule differs per subsystem).
 */
export async function readManifestName(manifestPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown }
    if (typeof parsed.name === 'string' && parsed.name.trim()) return parsed.name.trim()
  } catch {
    // missing/unreadable/malformed manifest → no name
  }
  return null
}

/**
 * True when `source` already lives inside the managed install root (it IS the
 * `<root>/<name>` dir, or sits anywhere beneath the root). Both ext installers use
 * this to detect a drop-in being registered in place — so it's copied, not cloned
 * onto itself. Pass already-resolved `source`/`installRoot` (callers `resolve()`).
 */
export function isUnderInstallRoot(
  resolvedSource: string,
  resolvedInstallRoot: string,
  name: string,
): boolean {
  return (
    resolvedSource === resolve(join(resolvedInstallRoot, name)) ||
    isPathBelow(resolvedInstallRoot, resolvedSource)
  )
}

/**
 * Delete an installed extension directory, but ONLY when it lives under the
 * managed install root — never an arbitrary path that happened to be discovered
 * elsewhere (a bundled root, a project dir, a symlink target). Both ext removers
 * share this guard so the confinement check can never drift between them. The
 * removal is best-effort (a missing dir is not an error).
 */
export async function removeIfUnderRoot(dir: string, installRoot: string): Promise<void> {
  // Strictly BELOW, never the root itself — `rm -rf`-ing the install root because a
  // caller passed it as the target is exactly the accident this guard exists to stop.
  if (isPathBelow(installRoot, dir)) {
    await rmrf(dir)
  }
}
