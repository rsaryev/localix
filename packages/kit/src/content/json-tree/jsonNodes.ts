/** JSON value classification for the collapsible {@link JsonTree} viewer. Pure + testable. */
export type JsonKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

/** Classify an arbitrary (already JSON-parsed) value. `undefined` is treated as `null`. */
export function jsonKind(value: unknown): JsonKind {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  const t = typeof value
  if (t === 'object') return 'object'
  if (t === 'number' || t === 'bigint') return 'number'
  if (t === 'boolean') return 'boolean'
  return 'string'
}

/** Collapsed one-glance summary for a branch: `[N]` for arrays, `{N}` for objects, else ''. */
export function jsonSummary(value: unknown): string {
  const k = jsonKind(value)
  if (k === 'array') return `[${(value as unknown[]).length}]`
  if (k === 'object') return `{${Object.keys(value as object).length}}`
  return ''
}

/** Object/array entries as `[key, value]` pairs (array indices become numeric keys). */
export function jsonEntries(value: unknown): Array<[string | number, unknown]> {
  if (Array.isArray(value)) return value.map((v, i) => [i, v])
  if (value && typeof value === 'object') return Object.entries(value as object)
  return []
}
