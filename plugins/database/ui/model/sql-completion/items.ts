// Completion-item builders: map names/keywords/functions/columns to EditorCompletionItem.
import type { EditorCompletionItem } from '@localixai/kit/code-editor'
import type { SqlSchemaModel } from './model'
import { cased } from './statement'
import { KIND_CLASS, KIND_FIELD, KIND_FUNCTION, KIND_KEYWORD, SQL_FUNCTIONS } from './vocab'
import { ownRecordValue } from '../../../shared/safe-record'

export function tableItem(name: string): EditorCompletionItem {
  return { label: name, detail: 'table', kind: KIND_CLASS }
}

export function cteItem(name: string): EditorCompletionItem {
  return { label: name, detail: 'cte', kind: KIND_CLASS }
}

export function aliasItem(name: string): EditorCompletionItem {
  return { label: name, detail: 'alias', kind: KIND_FIELD }
}

export function columnItem(
  column: string,
  table: string,
  meta?: { type?: string; pk?: boolean },
): EditorCompletionItem {
  // detail: "table" (no meta, keeps join disambiguation) or "table · type · PK".
  const detail = table + (meta?.type ? ` · ${meta.type}` : '') + (meta?.pk ? ' · PK' : '')
  return { label: column, detail, kind: KIND_FIELD }
}

export function keywordItems(before: string, keywords: string[]): EditorCompletionItem[] {
  return keywords.map((kw) => ({ label: cased(before, kw), kind: KIND_KEYWORD }))
}

export function functionItems(before: string): EditorCompletionItem[] {
  return SQL_FUNCTIONS.map((fn) => {
    const name = cased(before, fn)
    // Insert `NAME()` (or `COUNT(*)`) with the caret parked inside the parens ($0 cursor stop).
    const insertText = fn === 'COUNT' ? `${name}(*)` : `${name}($0)`
    return { label: name, detail: 'function', kind: KIND_FUNCTION, insertText }
  })
}

/** Insert text (with a `$0` caret stop) for a predicate operator that expects an argument. */
export function operatorInsert(op: string): string | undefined {
  if (op === 'IN') return 'IN ($0)'
  if (op === 'LIKE') return "LIKE '$0'"
  if (op === 'BETWEEN') return 'BETWEEN $0 AND '
  return undefined
}

/** Deduped column items over the given tables (in appearance order), skipping unknown tables. */
export function columnsOf(model: SqlSchemaModel, tables: string[]): EditorCompletionItem[] {
  const seen = new Set<string>()
  const out: EditorCompletionItem[] = []
  for (const table of tables) {
    const cols = ownRecordValue(model.columnsByTable, table)
    if (!cols) continue
    const meta = model.columnMeta ? ownRecordValue(model.columnMeta, table) : undefined
    for (const col of cols) {
      const key = `${col} ${table}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(columnItem(col, table, meta && ownRecordValue(meta, col)))
    }
  }
  return out
}

export function allColumns(model: SqlSchemaModel): EditorCompletionItem[] {
  return columnsOf(model, Object.keys(model.columnsByTable))
}
