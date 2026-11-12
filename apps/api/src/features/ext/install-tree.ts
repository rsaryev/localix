import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { isPathBelow } from '../../lib/path-containment'

// Install-tree primitives for the plugin installer: removal, naming and root containment.
// The copy itself is the kit boundary's `copyPluginTree` (`plugins/kit/ports/tree-copy.ts`).

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
