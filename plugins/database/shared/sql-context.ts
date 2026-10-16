/** Pure SQL identifiers used by both backend context providers and UI adapters. */

export interface SqlTableReference {
  schema?: string
  table: string
}

const IDENTIFIER = String.raw`(?:"(?:[^"]|"")+"|\`(?:[^\`]|\`\`)+\`|\[(?:[^\]]|\]\])+\]|[A-Za-z_][\w$]*)`
const TABLE_REFERENCE = new RegExp(
  String.raw`\b(?:from|join|into|update|table)\s+(${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER})*)`,
  'gi',
)

function unquoteIdentifier(identifier: string): string {
  const value = identifier.trim()
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/""/g, '"')
  if (value.startsWith('`') && value.endsWith('`')) return value.slice(1, -1).replace(/``/g, '`')
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).replace(/\]\]/g, ']')
  return value
}

/**
 * Extract table-like identifiers from common SQL clauses. Qualified names keep
 * their nearest schema segment; aliases and literal values are intentionally not
 * captured. Order is preserved and duplicates are removed case-insensitively.
 */
export function extractSqlTableReferences(text: string): SqlTableReference[] {
  const result: SqlTableReference[] = []
  const seen = new Set<string>()
  TABLE_REFERENCE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TABLE_REFERENCE.exec(text)) !== null) {
    const segments = match[1]!
      .split(/\s*\.\s*/)
      .map(unquoteIdentifier)
      .filter(Boolean)
    const table = segments.at(-1)
    if (!table) continue
    const schema = segments.length > 1 ? segments.at(-2) : undefined
    const key = `${schema?.toLowerCase() ?? ''}.${table.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...(schema ? { schema } : {}), table })
  }
  return result
}

/** Bare lower-case names used by the automatic cross-connection matcher. */
export function extractSqlTableRefs(text: string): string[] {
  return [
    ...new Set(extractSqlTableReferences(text).map((reference) => reference.table.toLowerCase())),
  ]
}
