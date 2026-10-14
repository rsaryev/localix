import type { z } from 'zod'
import type { readToolInputSchema } from './read-input'

type ReadInput = z.infer<typeof readToolInputSchema>

/** One file of a call: every field of a single read, with its path settled. */
export type ReadItemInput = Omit<ReadInput, 'path' | 'reads'> & { path: string }

/** Most items one call reads; the rest are named back so the model reads them separately. */
export const MAX_READ_ITEMS = 12

/**
 * The files one call asks for, in order. The top-level `path` keeps every field (offset, limit,
 * pages, …) exactly as a single read did; each `reads` entry inherits the fields that make sense
 * for any file (`cwd`, `mode`, `pages`, `sheet`) and brings only its own line range.
 *
 * An entry identical to an earlier one is dropped: the batch would otherwise deliver the same
 * bytes twice in one answer.
 */
export function readItems(input: ReadInput): ReadItemInput[] {
  const { path, reads, ...shared } = input
  const items: ReadItemInput[] = []
  if (path) items.push({ ...shared, path })
  for (const raw of reads ?? []) {
    // A caller that skips the schema (a direct `execute`) can still hand over a bare string.
    const entry: { path: string; start_line?: number; end_line?: number } =
      typeof raw === 'string' ? { path: raw } : raw
    items.push({
      ...(shared.cwd !== undefined ? { cwd: shared.cwd } : {}),
      ...(shared.mode !== undefined ? { mode: shared.mode } : {}),
      ...(shared.pages !== undefined ? { pages: shared.pages } : {}),
      ...(shared.sheet !== undefined ? { sheet: shared.sheet } : {}),
      path: entry.path,
      ...(entry.start_line !== undefined ? { start_line: entry.start_line } : {}),
      ...(entry.end_line !== undefined ? { end_line: entry.end_line } : {}),
    })
  }
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = JSON.stringify(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Every `{ path, cwd }` a raw (not yet validated) read input names — the top-level `path` and
 * each `reads` entry. Runs before zod, so it accepts only what is unambiguously a path string:
 * a bare string entry counts, as the schema's preprocess turns it into `{ path }`.
 */
export function readScopePaths(input: unknown): Array<{ path: string; cwd?: string }> {
  if (!input || typeof input !== 'object') return []
  const i = input as { path?: unknown; cwd?: unknown; reads?: unknown }
  const cwd = typeof i.cwd === 'string' ? i.cwd : undefined
  const out: Array<{ path: string; cwd?: string }> = []
  if (typeof i.path === 'string' && i.path) out.push({ path: i.path, cwd })
  let reads = i.reads
  if (typeof reads === 'string') {
    try {
      reads = JSON.parse(reads)
    } catch {
      reads = [reads]
    }
  }
  if (Array.isArray(reads)) {
    for (const entry of reads) {
      const path = typeof entry === 'string' ? entry : (entry as { path?: unknown } | null)?.path
      if (typeof path === 'string' && path) out.push({ path, cwd })
    }
  }
  return out
}
