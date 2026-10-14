/**
 * The batched shapes of the reading tools: `read` with `reads` (several files) and `search` with
 * `queries` (several patterns). Pure, no React — the cards, the stack labels and the chain
 * summary all count and name a batch the same way.
 */
import { asRecord, strField } from './format'

/** Every file a `read` call names: `path`, then each `reads` entry (object or bare string). */
export function readInputPaths(input: unknown): string[] {
  const record = asRecord(input)
  const single = strField(record, 'path')
  const out = single ? [single] : []
  const reads = record?.reads
  if (Array.isArray(reads)) {
    for (const entry of reads) {
      const path = typeof entry === 'string' ? entry : strField(entry, 'path')
      if (path) out.push(path)
    }
  }
  return out
}

/** Every pattern a `search` call names: `query`, then each `queries` entry. */
export function searchInputQueries(input: unknown): string[] {
  const record = asRecord(input)
  const single = strField(record, 'query')?.trim()
  const out = single ? [single] : []
  const queries = record?.queries
  if (Array.isArray(queries)) {
    for (const query of queries) {
      if (typeof query === 'string' && query.trim() && !out.includes(query.trim())) {
        out.push(query.trim())
      }
    }
  }
  return out
}

/**
 * How many files (read) or searches (search) one call stands for — 1 for every other tool, and
 * for a call whose input names nothing yet (still streaming).
 */
export function batchUnitCount(name: string, input: unknown): number {
  if (name === 'read') return Math.max(1, readInputPaths(input).length)
  if (name === 'search') return Math.max(1, searchInputQueries(input).length)
  return 1
}
