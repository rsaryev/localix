/**
 * Quote a SQL identifier for a dialect — the ONE owner, reachable from both sides.
 *
 * It lived only in `ui/model/sqlIdent.ts`, so the backend's DDL renderer could not call it
 * and spliced table/column/index names in raw. Those names come straight out of a foreign
 * database's introspection: `order`, `user`, `My Column`, `idx-a-b`, anything unicode. The
 * result was DDL that no engine will parse — handed to a HUMAN as a runnable dump, and to
 * the MODEL as the `localix://resource/db` resource it takes for the schema's ground truth.
 *
 * Same argument `ddl.ts` already makes for itself: the mini app's UI imports its wire types
 * from `../backend/*`, so shared knowledge belongs here, beside the type it renders. Pure —
 * types in, string out — so the SPA bundle can carry it.
 */
import type { DbDialect } from './drivers/port'

/** MySQL backticks, SQL Server square brackets, double quotes elsewhere. The closing
 *  character is escaped by doubling it, which is what keeps a name carrying one from
 *  ending the identifier early. */
export function quoteIdent(name: string, dialect: DbDialect): string {
  if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  if (dialect === 'mssql') return `[${name.replace(/]/g, ']]')}]`
  return `"${name.replace(/"/g, '""')}"`
}
