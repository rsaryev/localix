// Foreign-key-driven JOIN suggestions: full `a.col = b.col` conditions after ON, and
// one-pick `<table> ON <cond>` snippets after a JOIN keyword.
import type { EditorCompletionItem } from '@localixai/kit/code-editor'
import type { SqlSchemaModel } from './model'
import { aliasMap, referencedTables } from './statement'
import { KIND_SNIPPET } from './vocab'
import { defineRecordValue, ownRecordValue } from '../../../shared/safe-record'

/**
 * Full `a.col = b.col` equality conditions derived from foreign keys between the tables
 * the statement references — the natural completions right after a JOIN's `ON`. Renders
 * with the query's aliases when present. Empty when there is no FK linking two
 * referenced tables.
 */
export function joinConditions(text: string, model: SqlSchemaModel): EditorCompletionItem[] {
  const fks = model.foreignKeys
  if (!fks?.length) return []
  const refd = new Set(referencedTables(text, model))
  if (refd.size < 2) return []
  // First alias seen per table, to render `o.col` instead of `orders.col` when aliased.
  const aliasByTable: Record<string, string> = {}
  for (const [alias, table] of Object.entries(aliasMap(text))) {
    if (!ownRecordValue(aliasByTable, table)) defineRecordValue(aliasByTable, table, alias)
  }
  const ref = (t: string) => ownRecordValue(aliasByTable, t) ?? t

  const out: EditorCompletionItem[] = []
  const seen = new Set<string>()
  for (const fk of fks) {
    if (!refd.has(fk.table) || !refd.has(fk.refTable)) continue
    if (fk.columns.length !== fk.refColumns.length) continue
    const cond = fk.columns
      .map((c, i) => `${ref(fk.table)}.${c} = ${ref(fk.refTable)}.${fk.refColumns[i]}`)
      .join(' AND ')
    if (seen.has(cond)) continue
    seen.add(cond)
    out.push({ label: cond, detail: 'foreign key', kind: KIND_SNIPPET })
  }
  return out
}

/**
 * Full `<table> ON <a.x = b.y>` completions from foreign keys linking an
 * already-referenced table to a not-yet-joined one — offered right after a JOIN keyword
 * so a whole join lands in one pick. Renders with the query's aliases when present.
 */
export function joinTableSnippets(text: string, model: SqlSchemaModel): EditorCompletionItem[] {
  const fks = model.foreignKeys
  if (!fks?.length) return []
  const refd = referencedTables(text, model)
  if (refd.length === 0) return []
  const refdSet = new Set(refd)
  const aliasByTable: Record<string, string> = {}
  for (const [alias, table] of Object.entries(aliasMap(text))) {
    if (!ownRecordValue(aliasByTable, table)) defineRecordValue(aliasByTable, table, alias)
  }
  const ref = (t: string) => ownRecordValue(aliasByTable, t) ?? t

  const out: EditorCompletionItem[] = []
  const seen = new Set<string>()
  for (const fk of fks) {
    if (fk.columns.length !== fk.refColumns.length) continue
    let joinTable: string
    if (refdSet.has(fk.table) && !refdSet.has(fk.refTable)) {
      joinTable = fk.refTable
    } else if (refdSet.has(fk.refTable) && !refdSet.has(fk.table)) {
      joinTable = fk.table
    } else {
      continue
    }
    // Render `<childCol> = <parentCol>` with each side qualified by its table/alias.
    const cond = fk.columns
      .map((c, i) => {
        const child = `${ref(fk.table)}.${c}`
        const parent = `${ref(fk.refTable)}.${fk.refColumns[i]}`
        return `${child} = ${parent}`
      })
      .join(' AND ')
    const label = `${joinTable} ON ${cond}`
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ label, detail: 'join', kind: KIND_SNIPPET })
  }
  return out
}
