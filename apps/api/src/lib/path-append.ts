import { delimiter } from 'node:path'

/**
 * Put extra executable dirs (an enabled plugin's `bin/`) on a PATH AFTER the user's own
 * entries, as Claude Code does: a plugin adds commands but never shadows one the user already
 * has (`git`, `node`, …). A dir already on PATH is not repeated; empty entries are dropped.
 */
export function appendToPath(path: string | undefined, dirs: readonly string[] | undefined) {
  if (!dirs?.length) return path
  const existing = (path ?? '').split(delimiter).filter(Boolean)
  const seen = new Set(existing)
  const added = dirs.filter((dir) => dir && !seen.has(dir) && (seen.add(dir), true))
  return [...existing, ...added].join(delimiter)
}
