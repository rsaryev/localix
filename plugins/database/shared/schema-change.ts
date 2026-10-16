// Detect whether an executed SQL text changes the schema shape (so the schema tree should
// be refreshed) — as opposed to a plain read or a data-only DML. Used to auto-reload the
// schema after a DDL runs in the console / .sql runner — and, on the backend, to tell the UI
// that the agent's `query` changed a schema — WITHOUT reloading on every SELECT or
// INSERT/UPDATE/DELETE. Pure, so both sides share this one copy.
import { splitStatements } from './sql-statements'

/** First keyword of a schema-changing DDL statement. TRUNCATE is data-only, so excluded. */
const SCHEMA_DDL = /^(CREATE|DROP|ALTER|RENAME)\b/i

/** Strip leading line/block comments + whitespace so the first real keyword is exposed. */
function stripLeading(sql: string): string {
  let s = sql.trim()
  for (;;) {
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n')
      s = nl === -1 ? '' : s.slice(nl + 1).trimStart()
      continue
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/')
      s = end === -1 ? '' : s.slice(end + 2).trimStart()
      continue
    }
    break
  }
  return s
}

/** True if any top-level statement in `sql` is a CREATE / DROP / ALTER / RENAME. */
export function isSchemaChangingStatement(sql: string): boolean {
  return splitStatements(sql).some((stmt) => SCHEMA_DDL.test(stripLeading(stmt)))
}
