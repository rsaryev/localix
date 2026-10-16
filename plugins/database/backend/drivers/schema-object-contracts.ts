export type DbReferentialAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT'

export type DbForeignKeyMatch = 'SIMPLE' | 'FULL' | 'PARTIAL'

export interface DbForeignKey {
  /** Catalog constraint name, when the engine exposes it. */
  name?: string
  columns: string[]
  refSchema?: string
  refTable: string
  refColumns: string[]
  onUpdate?: DbReferentialAction
  onDelete?: DbReferentialAction
  /** PostgreSQL subset affected by ON DELETE SET NULL/DEFAULT. */
  onDeleteColumns?: string[]
  /** PostgreSQL match mode. SQLite accepts MATCH syntax but does not report/enforce it. */
  match?: DbForeignKeyMatch
  /** PostgreSQL transaction-timing attributes. */
  deferrable?: boolean
  initiallyDeferred?: boolean
  /** PostgreSQL validation state (`false` means an ALTER ... NOT VALID constraint). */
  validated?: boolean
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
  /** PostgreSQL 18 temporal/enforcement semantics. */
  period?: boolean
  enforced?: boolean
  /** SQL Server execution/optimizer state. */
  notForReplication?: boolean
  disabled?: boolean
  notTrusted?: boolean
}

export interface DbCheckConstraint {
  /** Catalog constraint name, when the engine exposes it. */
  name?: string
  /** Engine-reported boolean SQL expression. */
  expression: string
  /** PostgreSQL inheritance behavior. */
  noInherit?: boolean
  /** PostgreSQL 18+ enforcement state. */
  enforced?: boolean
  /** PostgreSQL validation state. */
  validated?: boolean
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
  /** SQL Server replication/state attributes. */
  notForReplication?: boolean
  disabled?: boolean
  notTrusted?: boolean
}

export interface DbKeyConstraint {
  name?: string
  type: 'PRIMARY KEY' | 'UNIQUE'
  columns: string[]
  /** PostgreSQL non-key payload columns. */
  includeColumns?: string[]
  /** PostgreSQL uniqueness/timing semantics. */
  nullsNotDistinct?: boolean
  deferrable?: boolean
  initiallyDeferred?: boolean
  withoutOverlaps?: boolean
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
  /** SQL Server key order and physical kind. */
  orders?: Array<'asc' | 'desc'>
  clustered?: boolean
}

export interface DbExclusionConstraint {
  name?: string
  /** PostgreSQL-native EXCLUDE clause from pg_get_constraintdef(). */
  definition: string
  /** Inherited from a PostgreSQL parent; visible structurally but not emitted again. */
  inherited?: boolean
}

/** One index on a table — name, its ordered column list, and uniqueness/PK role. */
export interface DbIndex {
  name: string
  /** Indexed columns, in key order. */
  columns: string[]
  unique: boolean
  /** Backs the primary key (sqlite `origin==='pk'`, mysql `PRIMARY`, `indisprimary`, `is_primary_key`). */
  primary?: boolean
  /**
   * Backs a declared PRIMARY/UNIQUE constraint rather than a standalone CREATE INDEX.
   * Renderers keep it in structural metadata but must not emit a second physical index.
   */
  constraint?: boolean
  /** Key sort direction, aligned with `columns`; omitted when the engine does not expose it. */
  orders?: Array<'asc' | 'desc'>
  /** MySQL prefix lengths, aligned with `columns` (`null` means the complete value). */
  prefixLengths?: Array<number | null>
  /** Non-key payload columns from a SQL Server INCLUDE clause. */
  includeColumns?: string[]
  /** Engine-native predicate for a partial/filtered index. */
  predicate?: string
  /** SQL Server rowstore index kind. */
  clustered?: boolean
  /** Engine-native standalone CREATE INDEX when the catalog stores/reconstructs one exactly. */
  createScript?: string
  /**
   * The native CREATE is authoritative because structured fields cannot represent an
   * expression key, partial predicate, or another engine-specific index clause.
   */
  createScriptOnly?: boolean
  /** Index partition cloned/attached beneath a PostgreSQL parent index. */
  inherited?: boolean
}

/** One table/view trigger with an engine-native executable definition. */
export interface DbTrigger {
  name: string
  createScript: string
  /** The trigger exists, but its executable body is encrypted or hidden by metadata permissions. */
  definitionUnavailable?: boolean
  /** Engine-native session/context statements that must run immediately before CREATE. */
  preCreateScripts?: string[]
  /** Engine-native follow-up statements that restore context or non-default trigger state. */
  postCreateScripts?: string[]
}

/** One PostgreSQL rewrite rule with an engine-native executable definition. */
export interface DbRule {
  name: string
  createScript: string
  /** Follow-up statements that restore disabled/replica/always firing state. */
  postCreateScripts?: string[]
}

/** One PostgreSQL extended planner-statistics object attached to a relation. */
export interface DbPostgresExtendedStatistic {
  schema: string
  name: string
  /** Canonical CREATE STATISTICS from pg_get_statisticsobjdef(). */
  createScript: string
  owner: string
  /** Omitted means ALTER STATISTICS ... SET STATISTICS DEFAULT. Zero is meaningful. */
  statisticsTarget?: number
  comment?: string
}
