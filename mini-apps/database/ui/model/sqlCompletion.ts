// Pure, framework-free SQL autocomplete over a live schema. No editor runtime, no React
// — it takes the document text + cursor offset + a flat schema model and returns
// completion items; the editor layer adapts these to its `completionSource` prop and
// does the prefix filtering. Kept pure so it is unit-testable in isolation.
//
// Facade: the vocabulary, analyzers, item builders, and join snippets live in
// ./sql-completion/*; this file owns only the context dispatch.
import type { EditorCompletionItem } from '@localixai/kit/code-editor'
import type { SqlSchemaModel } from './sql-completion/model'
import {
  aliasItem,
  allColumns,
  columnItem,
  columnsOf,
  cteItem,
  functionItems,
  keywordItems,
  operatorInsert,
  tableItem,
} from './sql-completion/items'
import { joinConditions, joinTableSnippets } from './sql-completion/joins'
import {
  aliasMap,
  atStatementStart,
  cased,
  cteNames,
  currentClause,
  currentStatement,
  referencedTables,
  resolveTableKey,
  selectAliases,
  stripQuotes,
} from './sql-completion/statement'
import {
  DOTTED,
  GENERAL_KEYWORDS,
  KEYWORD_TOKEN,
  KIND_KEYWORD,
  KIND_SNIPPET,
  LEADING_KEYWORDS,
  PREDICATE_OPERATORS,
  TABLE_CONTEXT,
} from './sql-completion/vocab'
import { ownRecordValue } from '../../shared/safe-record'

export type { SqlForeignKey, SqlSchemaModel } from './sql-completion/model'

/**
 * Completions for the cursor at `offset` in `text`, given the schema. Context-aware:
 * `t.` → columns of table/alias `t`; right after FROM/JOIN → table names; otherwise
 * columns + tables + keywords. The editor filters by the typed prefix.
 */
export function sqlCompletions(
  text: string,
  offset: number,
  model: SqlSchemaModel,
): EditorCompletionItem[] {
  const before = text.slice(0, offset)
  // Whole-statement analysis is scoped to the statement under the cursor (not the whole file),
  // so tables/aliases/CTEs from sibling statements don't pollute this statement's completions.
  const stmt = currentStatement(text, offset)

  // 0) Statement start → only statement-leading keywords (SELECT/INSERT/…), not columns.
  if (atStatementStart(before)) {
    return keywordItems(before, LEADING_KEYWORDS)
  }

  // 1) Dotted: `alias.col` → that table's columns.
  const dotted = DOTTED.exec(before)
  if (dotted) {
    const qualifier = stripQuotes(dotted[1])
    // The qualifier may be a bare table, a schema-qualified table, or an alias whose
    // target is (schema-)qualified — resolve all of them to the model's bare key.
    const aliases = aliasMap(stmt)
    const target = resolveTableKey(model, qualifier)
      ? qualifier
      : ownRecordValue(aliases, qualifier)
    const table = target ? resolveTableKey(model, target) : undefined
    const cols = table ? ownRecordValue(model.columnsByTable, table) : undefined
    if (cols && table) {
      const meta = model.columnMeta ? ownRecordValue(model.columnMeta, table) : undefined
      return cols.map((c) => columnItem(c, table, meta && ownRecordValue(meta, c)))
    }
    return allColumns(model) // unknown qualifier — still offer something useful
  }

  // 2) Right after a table-introducing keyword → table names. After a JOIN keyword,
  //    prepend one-pick `<table> ON …` snippets from foreign keys to referenced tables.
  if (TABLE_CONTEXT.test(before)) {
    const joinCtx = /\bjoin\s+("?[\w.]*)?$/i.test(before)
    const snippets = joinCtx ? joinTableSnippets(stmt, model) : []
    return [...snippets, ...cteNames(stmt).map(cteItem), ...model.tables.map(tableItem)]
  }

  // 2b) Right after a JOIN's `ON` → FK-based join conditions first, then columns of
  //     the referenced tables (so there's always something useful to pick).
  if (/\bjoin\b/i.test(before) && /\bon\s+$/i.test(before)) {
    const refd = referencedTables(stmt, model)
    const cols = columnsOf(model, refd.length ? refd : Object.keys(model.columnsByTable))
    return [...joinConditions(stmt, model), ...cols]
  }

  // 2c) Inside an `INSERT INTO t ( … )` column list → columns of the target table.
  const insertCols = /insert\s+into\s+("?[\w.]+"?)\s*\([^)]*$/i.exec(before)
  if (insertCols) {
    const table = stripQuotes(insertCols[1])
    const cols = ownRecordValue(model.columnsByTable, table)
    if (cols) return cols.map((c) => columnItem(c, table))
  }

  // 2d) Right after a COMPLETED column (identifier + space, not a keyword): in a predicate
  //     clause (WHERE/HAVING/ON) offer comparison operators; in ORDER BY offer sort direction.
  const tailTok = /([\w".]+)\s+$/.exec(before)?.[1]?.toLowerCase()
  if (tailTok && !KEYWORD_TOKEN.test(tailTok)) {
    const clause = currentClause(before.slice(before.lastIndexOf(';') + 1))
    if (clause === 'where' || clause === 'having' || clause === 'on') {
      return PREDICATE_OPERATORS.map((op) => ({
        label: /^[a-z]/i.test(op) ? cased(before, op) : op,
        kind: KIND_KEYWORD,
        insertText: operatorInsert(op),
      }))
    }
    if (clause === 'order by') {
      return ['ASC', 'DESC'].map((kw) => ({ label: cased(before, kw), kind: KIND_KEYWORD }))
    }
  }

  // 3) General position → columns, then tables, then keywords. Scope columns to the
  //    tables the statement actually references (FROM/JOIN) so `SELECT | FROM users`
  //    surfaces users' columns first; other tables' columns still follow as a fallback.
  const refd = referencedTables(stmt, model)
  // Referenced tables first, then the rest — columnsOf dedupes by (column, table).
  const rest = Object.keys(model.columnsByTable).filter((t) => !refd.includes(t))
  const columns = columnsOf(model, [...refd, ...rest])
  // Right after `SELECT` (before any column) offer `*` first — a projection wildcard,
  // not a column (KEYWORD kind), so column-scoped consumers still see real columns first —
  // plus an "expand columns" snippet per referenced table (insert its explicit column list)
  // so `SELECT | FROM users` can drop in `id, name, …` in one pick.
  const afterSelect = /\bselect\s+(distinct\s+)?$/i.test(before)
  const star = afterSelect ? [{ label: '*', detail: 'all columns', kind: KIND_KEYWORD }] : []
  const expand = afterSelect
    ? refd.flatMap((t) => {
        const cols = ownRecordValue(model.columnsByTable, t)
        return cols && cols.length > 0
          ? [
              {
                label: `${t}.* → columns`,
                detail: `expand ${t}`,
                kind: KIND_SNIPPET,
                insertText: cols.join(', '),
              },
            ]
          : []
      })
    : []
  return [
    ...star,
    ...expand,
    ...columns,
    ...selectAliases(stmt).map(aliasItem),
    ...cteNames(stmt).map(cteItem),
    ...model.tables.map(tableItem),
    ...functionItems(before),
    ...keywordItems(before, GENERAL_KEYWORDS),
  ]
}

/** LSP-style offset from a {line, character} position (both 0-based). */
export function offsetAt(text: string, line: number, character: number): number {
  let offset = 0
  const lines = text.split('\n')
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1
  return offset + character
}
