// Render loaded per-table schemas as SQL DDL, for the schema browser's DDL view and
// for a whole-schema export.
//
// The CREATE itself is NOT built here: it is one piece of knowledge with one owner,
// `../../backend/ddl` — the same renderer the `localix://resource/db` resource expander uses (the
// mini app's UI already imports its wire types across that boundary). What this module owns is the
// HUMAN reading: a schema browser also shows explicit indexes, PostgreSQL table state/rules,
// and native triggers.
import {
  buildCommentStatements,
  buildIndexStatements,
  buildPostgresAccessStatements,
  buildPostgresExtendedStatisticsStatements,
  buildPostgresSequenceStateStatements,
  buildPostgresTableStateStatements,
  buildRuleStatements,
  buildTableDDL as buildCreate,
  buildTriggerStatements,
} from '../../backend/ddl'
import type { DbDialect, DbTableSchema } from '../dbClient'

/**
 * Full CREATE statement for a single table, for display in the schema browser: the engine's
 * original `createScript` when it has one (sqlite stores it verbatim), else a reconstructed
 * CREATE — plus the table's explicit (non-PK) indexes, which no `createScript` carries and
 * which the PRIMARY KEY clause does not imply, followed by PostgreSQL table state/rules and
 * native trigger definitions. Not capped (single table).
 */
export function buildTableDDL(table: DbTableSchema, dialect: DbDialect): string {
  const create = buildCreate(table, dialect)
  const commentStmts = buildCommentStatements(table, dialect)
  const indexStmts = buildIndexStatements(table, dialect)
  const postgresStateStmts = buildPostgresTableStateStatements(table, dialect)
  const ruleStmts = buildRuleStatements(table)
  const triggerStmts = buildTriggerStatements(table)
  const accessStmts = buildPostgresAccessStatements(table, dialect)
  const extendedStatisticStmts = buildPostgresExtendedStatisticsStatements(table, dialect)
  const sequenceStmts = buildPostgresSequenceStateStatements(table, dialect)
  const attached = [
    ...commentStmts,
    ...indexStmts,
    ...postgresStateStmts,
    ...ruleStmts,
    ...triggerStmts,
    ...accessStmts,
    ...extendedStatisticStmts,
    ...sequenceStmts,
  ]
  return attached.length > 0 ? `${create}\n\n${attached.join('\n')}` : create
}

/**
 * A faithful whole-schema dump: each table's full {@link buildTableDDL} (engine
 * `createScript` when available, else a reconstructed CREATE + explicit indexes, with native
 * triggers), under a `-- Table:`/`-- View:` header, in the given order. Not capped — this is
 * a user-initiated export, not model context.
 *
 * There is deliberately no bounded "schema summary for the prompt" counterpart here. The
 * SQL console grounds edit prediction by sending the connection's `localix://resource/db` RESOURCE REFERENCE
 * (`useSqlNextEdit`), which the server expands through the mini app's registered Context Fabric
 * provider — so schema content, its provenance, and its sensitivity label are decided on the
 * server, and this UI never hands schema text to a model task itself.
 */
export function buildSchemaDump(tables: DbTableSchema[], dialect: DbDialect): string {
  return tables
    .map(
      (t) => `-- ${t.type === 'view' ? 'View' : 'Table'}: ${t.name}\n${buildTableDDL(t, dialect)}`,
    )
    .join('\n\n')
}
