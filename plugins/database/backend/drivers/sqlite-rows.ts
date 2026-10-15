/**
 * Read at most `RESULT_ROW_CAP`+1 rows of a prepared bun:sqlite statement, with the column
 * names that actually belong to those cells.
 *
 * `stmt.values()` materializes every row at once, so it cannot stop; `iterate()` can, but it
 * yields NAME-keyed objects, which is only lossless when the names are unique — `SELECT a.id,
 * b.id` would come back one column short. Bun's `columnNames` cannot tell either: it is itself
 * de-duplicated AND reordered (`SELECT t.id, t.v, t.id` reports `["v","id"]` over three cells),
 * so a grid built from it put every header over the wrong column. `declaredTypes` has one entry
 * per REAL column once the statement has stepped, so the first row decides — unique names keep
 * iterating (the common case), repeated names re-run the read through `values()` and cap it.
 *
 * The true names of a collapsed read come from SQLite itself: wrapped as a subquery
 * (`SELECT * FROM (…) LIMIT 0`, which steps nothing), SQLite names each repeat `id:1`, in order,
 * and the suffix comes off again. A write cannot be wrapped (and must not run twice), so its
 * repeated columns are named by position — honest about the order, rather than wrong.
 *
 * Only a statement that just reads is iterated at all. Re-running a write to recover its
 * columns would perform it twice, and stopping one mid-step changes what it did; a writing
 * statement keeps the single full `values()` pass and only its first rows are kept.
 */
import type { Statement } from 'bun:sqlite'
import { capRows, createRowCollector } from '../../shared/result-cap'
import { isReadOnlyStatementForDialect } from '../read-only/sql'

/** `["id","v","id:1"]` → `["id","v","id"]`; a `:N` only comes off a name seen before it. */
export function unsuffixRepeatedNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  return names.map((name) => {
    const base = /^(.*):\d+$/.exec(name)?.[1]
    const resolved = base !== undefined && seen.has(base) ? base : name
    seen.add(resolved)
    return resolved
  })
}

export function readSqliteRows(
  stmt: Statement,
  columnNames: string[],
  params: unknown[],
  sql: string,
  /** The statement's real names, in order, from a wrapped probe — `null` when it cannot be wrapped. */
  probeNames: () => string[] | null,
): { rows: unknown[][]; truncated: boolean; columns: string[] } {
  const reads = isReadOnlyStatementForDialect(sql, 'sqlite')
  const readAll = () => {
    const capped = capRows(stmt.values(...(params as never[])) as unknown[][])
    const width = stmt.declaredTypes.length
    if (width === columnNames.length) return { ...capped, columns: columnNames }
    const real = reads ? probeNames() : null
    const columns =
      real?.length === width
        ? unsuffixRepeatedNames(real)
        : Array.from({ length: width }, (_, i) => `column ${i + 1}`)
    return { ...capped, columns }
  }
  if (!reads) return readAll()
  const collector = createRowCollector()
  let checked = false
  for (const record of stmt.iterate(...(params as never[])) as Iterable<Record<string, unknown>>) {
    if (!checked) {
      checked = true
      if (stmt.declaredTypes.length !== columnNames.length) return readAll()
    }
    if (collector.push(columnNames.map((name) => record[name]))) break
  }
  return { rows: collector.rows, truncated: collector.truncated, columns: columnNames }
}
