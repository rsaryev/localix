/**
 * Shared primitives for serialized Kubernetes object parsers — lenient coercers + the
 * top-level JSON/items readers. Split out of `parse.ts` (the barrel) unchanged; see
 * that file for the overall parsing story. Kept free of any I/O so they are
 * unit-testable.
 */

export const str = (v: unknown): string => {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Parse a top-level JSON document; returns null on empty/invalid input. */
export function parseJson(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function itemsOf(doc: unknown): Record<string, unknown>[] {
  if (!doc || typeof doc !== 'object') return []
  const items = (doc as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items.filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
}
