/**
 * Canonical key for a filesystem path across the VBC dependency graph.
 *
 * Trimmed, leading `./` stripped, lowercased — so a tool-INPUT path (`./src/a.ts`),
 * a free-TEXT mention (`src/a.ts`), and a supersession TARGET all collapse to ONE
 * key. Previously the target resolver stripped `./` but the entity/inverted-index
 * keys did not, so a `./`-prefixed path produced a different key than its plain
 * mention and the dep graph silently missed that edge (under-scoring a depended-on
 * message → eligible for earlier compression). Single source of truth, used by
 * targets.ts, entities.ts, and dep-graph.ts.
 */
export function normalizePathKey(p: string): string {
  return p.trim().replace(/^\.\//, '').toLowerCase()
}

/**
 * Every file path a tool call's arguments name, raw (not normalized): `path` / `file` /
 * `file_path`, plus each entry of a batched read's `reads` (`{ path }` objects or bare strings).
 * One reader of the batch shape, so the target resolver, the wire live-read scan and the epoch
 * card's file list cannot disagree about which files one call read.
 */
export function inputFilePaths(args: unknown): string[] {
  if (!args || typeof args !== 'object') return []
  const a = args as Record<string, unknown>
  const out: string[] = []
  for (const field of ['path', 'file', 'file_path'] as const) {
    const v = a[field]
    if (typeof v === 'string' && v.trim()) {
      out.push(v)
      break
    }
  }
  if (Array.isArray(a.reads)) {
    for (const entry of a.reads) {
      const v =
        typeof entry === 'string' ? entry : (entry as { path?: unknown } | null | undefined)?.path
      if (typeof v === 'string' && v.trim()) out.push(v)
    }
  }
  return out
}

/** The search patterns a call names: `query` and each entry of a batched `queries`. */
export function inputQueries(args: unknown): string[] {
  if (!args || typeof args !== 'object') return []
  const a = args as Record<string, unknown>
  const all = [a.query, ...(Array.isArray(a.queries) ? a.queries : [])]
  return all.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
}
