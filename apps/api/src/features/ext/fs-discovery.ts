import { promises as fs } from 'node:fs'

import { resolveWithin } from '../../lib/path-containment'

/**
 * Shared filesystem-discovery primitives used by both the plugins subsystem
 * (`features/plugins/discovery.ts`). Keep this module dependency-light:
 * only Node built-ins, no imports from `chat`, `ui`, or feature-specific code.
 */

/**
 * Return true if the path exists and is accessible, false otherwise.
 * Swallows all filesystem errors (ENOENT, EACCES, …).
 */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Return the names of every immediate subdirectory of `dir`.
 * Returns an empty array when the directory does not exist or cannot be read.
 */
export async function listSubdirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).flatMap((e) =>
      e.isDirectory() ? [e.name] : [],
    )
  } catch {
    return []
  }
}

/**
 * The ext-discovery layer's name for the shared containment rule: resolve `relPath`
 * against `dir` and return the absolute path only when it stays INSIDE `dir` — `null`
 * when it escapes via `..` traversal, an absolute-path shortcut, or a sibling-prefix
 * attack (`/a/rootExtra` for root `/a/root`).
 *
 * The rule itself is NOT re-implemented here. It has ONE owner —
 * `lib/path-containment.ts` — because it is a security check, and a second copy of a
 * security check that happens to agree with the first is invisible until it doesn't
 * (see `lib/path-containment-contract.test.ts`). This alias exists only so the many
 * discovery call sites keep reading in the vocabulary of their own layer.
 */
export const confineToDir = resolveWithin

/**
 * Merge ordered scan batches into a single, name-deduped, name-sorted list.
 * Batches MUST be passed in precedence order (highest first): the FIRST item
 * with a given `manifest.name` wins, so an earlier batch shadows a later one on a
 * name clash. The result is sorted by name for a stable UI ordering.
 *
 * Used by the plugin discovery layer, which applies the
 * identical "project > global > … > bundled, first-wins" precedence rule.
 */
export function mergeByPrecedence<T extends { manifest: { name: string } }>(batches: T[][]): T[] {
  const byName = new Map<string, T>()
  for (const batch of batches) {
    for (const item of batch) {
      if (!byName.has(item.manifest.name)) byName.set(item.manifest.name, item)
    }
  }
  return [...byName.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
}
