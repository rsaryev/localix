import { confineToDir as _confineToDir } from '../ext/fs-discovery'

/**
 * Path-resolution helper shared between discovery.ts (entrypoint resolution) and
 * discovery-cc-files.ts (Claude Code flat-file collection). Kept in its own leaf
 * module so both can import it without a cycle.
 */

/**
 * Normalize a manifest path-list field (string | string[]) to absolute paths,
 * CONFINED to the plugin directory. Security: a manifest must not point its
 * artifacts (tools/skills/mcp) outside its own folder, so absolute paths and `..`
 * escapes are dropped — even for a disabled plugin whose manifest is only read.
 */
export function toAbsList(dir: string, field: string | string[] | undefined): string[] {
  if (!field) return []
  const arr = Array.isArray(field) ? field : [field]
  return arr.flatMap((p) => {
    const abs = _confineToDir(dir, p)
    return abs !== null ? [abs] : []
  })
}
