// Wrap a statement in the dialect's query-plan command for the console's "Explain"
// action. Pure + framework-free. Uses PLAIN EXPLAIN (never ANALYZE) so the wrapped
// query is only planned, never executed. Returns null for dialects without a portable
// one-shot EXPLAIN (SQL Server needs a session-level SET SHOWPLAN — out of scope).
import type { DbDialect } from '../dbClient'
import { DATABASE_DRIVER_CATALOG } from '../../shared/driver-catalog'

export function explainQuery(sql: string, dialect: DbDialect): string | null {
  const stmt = sql
    .trim()
    .replace(/\s*;\s*$/, '')
    .trim()
  if (!stmt) return null
  switch (dialect) {
    case 'sqlite':
      return `EXPLAIN QUERY PLAN ${stmt};`
    case 'postgres':
    case 'mysql':
    case 'clickhouse':
      return `EXPLAIN ${stmt};`
    case 'mssql':
    case 'redis':
    case 'mongodb':
    case 'elasticsearch':
      break
  }
  return null
}

/** Whether this dialect supports the one-shot Explain action (drives button visibility). */
export function supportsExplain(dialect: DbDialect): boolean {
  return DATABASE_DRIVER_CATALOG[dialect].capabilities.explain
}
