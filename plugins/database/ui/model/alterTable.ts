import { DATABASE_DRIVER_CATALOG, getDatabaseDriverManifest } from '../../shared/driver-catalog'
import type { DbColumn, DbDialect, DbTableSchema } from '../dbClient'
import { validateDefaultSqlExpression } from './defaultSql'
import { quoteIdent } from './sqlIdent'

export interface AlterColumnDraft {
  /** Stable UI identity; an existing column keeps its original name here. */
  id: string
  originalName?: string
  name: string
  dataType: string
  nullable: boolean
  defaultValue: string
  primaryKey: boolean
  deleted: boolean
}

export interface AlterTablePlan {
  sql: string
  /** Statements without transaction controls, ready for the backend's atomic batch port. */
  statements: string[]
  changeCount: number
  warnings: string[]
  /**
   * The generated SQL is useful as a starting point, but normalized metadata cannot
   * prove that applying it would preserve every engine-native schema object.
   */
  manualOnly?: boolean
}

const normalizeDefault = (value: string | null | undefined) => value?.trim() ?? ''
const columnDefault = (column: DbColumn) => normalizeDefault(column.defaultValue)
const changed = (base: DbColumn, draft: AlterColumnDraft) => ({
  name: base.name !== draft.name.trim(),
  type: base.dataType.trim() !== draft.dataType.trim(),
  nullable: base.nullable !== draft.nullable,
  defaultValue: columnDefault(base) !== draft.defaultValue.trim(),
})

const qualifiedTable = (dialect: DbDialect, table: string, schema?: string): string => {
  const quoted = quoteIdent(table, dialect)
  return schema?.trim() ? `${quoteIdent(schema.trim(), dialect)}.${quoted}` : quoted
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

function columnDefinition(dialect: DbDialect, draft: AlterColumnDraft): string {
  const defaultSql = draft.defaultValue.trim()
  return [
    quoteIdent(draft.name.trim(), dialect),
    draft.dataType.trim(),
    draft.nullable ? 'NULL' : 'NOT NULL',
    defaultSql ? `DEFAULT ${defaultSql}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function sqliteColumnDefinition(
  draft: AlterColumnDraft,
  { primaryKey, autoincrement }: { primaryKey: boolean; autoincrement: boolean },
): string {
  const defaultSql = draft.defaultValue.trim()
  return [
    quoteIdent(draft.name.trim(), 'sqlite'),
    draft.dataType.trim(),
    primaryKey ? 'PRIMARY KEY' : '',
    autoincrement ? 'AUTOINCREMENT' : '',
    draft.nullable && !primaryKey ? 'NULL' : 'NOT NULL',
    defaultSql ? `DEFAULT ${defaultSql}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function sqliteRebuildRequired(table: DbTableSchema, drafts: AlterColumnDraft[]): boolean {
  const baseByName = new Map(table.columns.map((column) => [column.name, column]))
  return drafts.some((draft) => {
    if (!draft.originalName || draft.deleted) return false
    const base = baseByName.get(draft.originalName)
    if (!base) return false
    const delta = changed(base, draft)
    return delta.type || delta.nullable || delta.defaultValue
  })
}

/**
 * SQLite's documented generalized ALTER procedure: create the desired table, copy
 * paired columns, replace the old table, then restore the indexes visible in normalized
 * metadata. SQLite's complete procedure also requires native trigger/view/index SQL,
 * which this model does not own, so callers must keep this generated plan manual-only.
 */
function buildSqliteRebuildPlan(table: DbTableSchema, drafts: AlterColumnDraft[]): AlterTablePlan {
  const q = (name: string) => quoteIdent(name, 'sqlite')
  const active = drafts.filter((draft) => !draft.deleted)
  const activeByOriginal = new Map(
    active.flatMap((draft) => (draft.originalName ? [[draft.originalName, draft] as const] : [])),
  )
  const mappedColumn = (name: string) => activeByOriginal.get(name)?.name.trim()
  const primaryKey = table.primaryKey.flatMap((name) => {
    const mapped = mappedColumn(name)
    return mapped ? [mapped] : []
  })
  const inlinePrimaryKey = primaryKey.length === 1 ? primaryKey[0] : null
  const hasAutoincrement =
    inlinePrimaryKey !== null && /\bAUTOINCREMENT\b/i.test(table.createScript ?? '')

  const definitions = active.map(
    (draft) =>
      `  ${sqliteColumnDefinition(draft, {
        primaryKey: inlinePrimaryKey === draft.name.trim(),
        autoincrement: hasAutoincrement && inlinePrimaryKey === draft.name.trim(),
      })}`,
  )
  if (primaryKey.length > 1) definitions.push(`  PRIMARY KEY (${primaryKey.map(q).join(', ')})`)

  // SQLite reports UNIQUE table constraints as reserved sqlite_autoindex_* indexes.
  // Put those constraints back into CREATE TABLE; attempting to recreate their reserved
  // index names explicitly would fail.
  for (const index of table.indexes) {
    if (!index.unique || index.primary || !index.name.startsWith('sqlite_autoindex_')) continue
    const columns = index.columns.map(mappedColumn)
    if (columns.every((name): name is string => !!name))
      definitions.push(`  UNIQUE (${columns.map(q).join(', ')})`)
  }

  for (const foreignKey of table.foreignKeys) {
    const columns = foreignKey.columns.map(mappedColumn)
    if (!columns.every((name): name is string => !!name)) continue
    const selfReference = foreignKey.refTable === table.name
    const refColumns = selfReference
      ? foreignKey.refColumns.map((name) => mappedColumn(name) ?? name)
      : foreignKey.refColumns
    const referencedColumns = refColumns.length > 0 ? ` (${refColumns.map(q).join(', ')})` : ''
    const onDelete = foreignKey.onDelete ? ` ON DELETE ${foreignKey.onDelete}` : ''
    const onUpdate = foreignKey.onUpdate ? ` ON UPDATE ${foreignKey.onUpdate}` : ''
    definitions.push(
      `  FOREIGN KEY (${columns.map(q).join(', ')}) REFERENCES ${q(foreignKey.refTable)}${referencedColumns}${onDelete}${onUpdate}`,
    )
  }

  const source = qualifiedTable('sqlite', table.name, table.schema)
  const temporaryName = `__localix_new_${table.name}`
  const temporary = qualifiedTable('sqlite', temporaryName, table.schema)
  const tableOptions = [
    /\bSTRICT\b/i.test(table.createScript ?? '') ? 'STRICT' : '',
    /\bWITHOUT\s+ROWID\b/i.test(table.createScript ?? '') ? 'WITHOUT ROWID' : '',
  ].filter(Boolean)
  const createSuffix = tableOptions.length > 0 ? ` ${tableOptions.join(', ')}` : ''

  const copied = active.filter((draft) => !!draft.originalName)
  const statements = [
    // The backend starts the transaction before running this list. Deferring FK checks
    // lets a referenced table disappear and reappear under the same name within that
    // transaction; the final commit still refuses a broken relationship.
    'PRAGMA defer_foreign_keys = ON;',
    `CREATE TABLE ${temporary} (\n${definitions.join(',\n')}\n)${createSuffix};`,
  ]
  if (copied.length > 0) {
    statements.push(
      `INSERT INTO ${temporary} (${copied.map((draft) => q(draft.name.trim())).join(', ')})\nSELECT ${copied.map((draft) => q(draft.originalName!)).join(', ')} FROM ${source};`,
    )
  }
  statements.push(`DROP TABLE ${source};`)
  statements.push(`ALTER TABLE ${temporary} RENAME TO ${q(table.name)};`)

  const warnings = [
    `SQLite will rebuild ${table.name} transactionally because this change has no direct ALTER COLUMN form.`,
    'Automatic apply is disabled because SQLite rebuilds must preserve native schema objects and constraint clauses that cannot always be safely rewritten. Compare this script with the DDL tab, then adjust it in the console.',
  ]
  const rewritesExistingColumns = drafts.some(
    (draft) =>
      draft.originalName !== undefined &&
      (draft.deleted || draft.name.trim() !== draft.originalName),
  )
  for (const index of table.indexes) {
    if (index.primary || index.name.startsWith('sqlite_autoindex_')) continue
    if (index.createScriptOnly) {
      if (!rewritesExistingColumns && index.createScript) {
        statements.push(`${index.createScript.trim().replace(/;+\s*$/u, '')};`)
      } else {
        warnings.push(
          `Index ${index.name} is omitted because its native expression or predicate cannot be safely rewritten after a column rename/drop.`,
        )
      }
      continue
    }
    const columns = index.columns.map(mappedColumn)
    if (!columns.every((name): name is string => !!name)) {
      warnings.push(`Index ${index.name} is omitted because one of its columns is removed.`)
      continue
    }
    const indexName = table.schema ? `${q(table.schema)}.${q(index.name)}` : q(index.name)
    statements.push(
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${indexName} ON ${q(table.name)} (${columns.map(q).join(', ')});`,
    )
  }
  for (const trigger of table.triggers ?? []) {
    if (!rewritesExistingColumns) {
      for (const script of [
        ...(trigger.preCreateScripts ?? []),
        trigger.createScript,
        ...(trigger.postCreateScripts ?? []),
      ]) {
        const normalized = script.trim().replace(/;+\s*$/u, '')
        if (normalized) statements.push(`${normalized};`)
      }
    } else {
      warnings.push(
        `Trigger ${trigger.name} is omitted because its native body cannot be safely rewritten after a column rename/drop.`,
      )
    }
  }
  statements.push('PRAGMA foreign_key_check;')

  if (/\b(CHECK|GENERATED|COLLATE)\b/i.test(table.createScript ?? ''))
    warnings.push(
      'The original DDL contains CHECK, generated, or collation clauses that are not available in normalized metadata; compare the reviewed SQL with the DDL tab before running it.',
    )
  warnings.push('Back up file databases before applying a table rebuild.')

  let changeCount = 0
  const baseByName = new Map(table.columns.map((column) => [column.name, column]))
  for (const draft of drafts) {
    if (!draft.originalName) {
      if (!draft.deleted && draft.name.trim()) changeCount++
      continue
    }
    if (draft.deleted) {
      changeCount++
      continue
    }
    const base = baseByName.get(draft.originalName)
    if (base) changeCount += Object.values(changed(base, draft)).filter(Boolean).length
  }

  return {
    sql: ['BEGIN IMMEDIATE;', ...statements, 'COMMIT;'].join('\n'),
    statements,
    changeCount,
    warnings: [...new Set(warnings)],
    manualOnly: true,
  }
}

export function createAlterColumnDrafts(table: DbTableSchema): AlterColumnDraft[] {
  return table.columns.map((column) => ({
    id: `existing:${column.name}`,
    originalName: column.name,
    name: column.name,
    dataType: column.dataType,
    nullable: column.nullable,
    defaultValue: columnDefault(column),
    primaryKey: column.pk,
    deleted: false,
  }))
}

export function createNewColumnDraft(id: string, dataType: string): AlterColumnDraft {
  return {
    id,
    name: '',
    dataType,
    nullable: true,
    defaultValue: '',
    primaryKey: false,
    deleted: false,
  }
}

/**
 * Build a review-only ALTER script from the table editor's base/current pair.
 *
 * The UI reads mutation support from the same canonical driver manifest, while this one
 * generator owns dialect syntax. Unsupported operations fail closed instead of producing
 * plausible-looking SQL that may rebuild or corrupt a table.
 */
export function buildAlterTablePlan(
  dialect: DbDialect,
  table: DbTableSchema,
  drafts: AlterColumnDraft[],
): AlterTablePlan {
  const mutations = getDatabaseDriverManifest(dialect).schemaMutations
  if (!mutations)
    throw new Error(`${DATABASE_DRIVER_CATALOG[dialect].label} table editing is unavailable`)

  const active = drafts.filter((column) => !column.deleted)
  if (active.length === 0) throw new Error('A table must keep at least one column')
  for (const column of active) {
    if (!column.name.trim()) throw new Error('Every column needs a name')
    if (!column.dataType.trim()) throw new Error(`${column.name.trim()} needs a data type`)
    const base = column.originalName
      ? table.columns.find((candidate) => candidate.name === column.originalName)
      : undefined
    const defaultChanged = !base || columnDefault(base) !== column.defaultValue.trim()
    const defaultError = defaultChanged ? validateDefaultSqlExpression(column.defaultValue) : null
    if (defaultError) throw new Error(`${column.name.trim()}: ${defaultError}`)
  }
  const normalizedNames = active.map((column) => column.name.trim().toLocaleLowerCase())
  if (new Set(normalizedNames).size !== normalizedNames.length)
    throw new Error('Column names must be unique')

  if (dialect === 'sqlite' && sqliteRebuildRequired(table, drafts))
    return buildSqliteRebuildPlan(table, drafts)

  const target = qualifiedTable(dialect, table.name, table.schema)
  const baseByName = new Map(table.columns.map((column) => [column.name, column]))
  const statements: string[] = []
  const warnings: string[] = []
  // MySQL DDL commits implicitly, so several ALTER statements cannot be made atomic by
  // the backend transaction wrapper. Keep every change to this table in one atomic DDL
  // statement instead.
  const mysqlDrops: string[] = []
  const mysqlRenames: string[] = []
  const mysqlDefaults: string[] = []
  const mysqlAdds: string[] = []
  let changeCount = 0

  for (const draft of drafts) {
    if (!draft.originalName) {
      if (draft.deleted || !draft.name.trim()) continue
      if (!mutations.addColumn) throw new Error('Adding columns is not supported by this driver')
      const clause = `ADD COLUMN ${columnDefinition(dialect, draft)}`
      if (dialect === 'mysql') mysqlAdds.push(clause)
      else statements.push(`ALTER TABLE ${target} ${clause};`)
      changeCount++
      if (!draft.nullable && !draft.defaultValue.trim())
        warnings.push(
          `${draft.name.trim()} is required and has no default; adding it can fail when the table already contains rows.`,
        )
      continue
    }

    const base = baseByName.get(draft.originalName)
    if (!base) throw new Error(`Column ${draft.originalName} is no longer present`)
    if (draft.deleted) {
      if (!mutations.dropColumn) throw new Error('Dropping columns is not supported by this driver')
      const clause = `DROP COLUMN ${quoteIdent(base.name, dialect)}`
      if (dialect === 'mysql') mysqlDrops.push(clause)
      else statements.push(`ALTER TABLE ${target} ${clause};`)
      warnings.push(`Dropping ${base.name} permanently removes its data.`)
      changeCount++
      continue
    }

    const delta = changed(base, draft)
    const nextName = draft.name.trim()
    // Engine-generated columns. The editor's normalized model has no field for a generated
    // expression or an identity clause, so these edits cannot be expressed — and the engine
    // forbids them anyway. Fail closed here as well as disabling the inputs: a guard that
    // lives only in the form is one stale draft away from emitting the statement.
    //
    // PostgreSQL, "Generated Columns" (ddl-generated-columns.html): generated columns
    // "cannot have their own column defaults or identity definitions".
    if (delta.defaultValue && base.generated)
      throw new Error(
        `${base.name} is a generated column (GENERATED ALWAYS AS …) — a generated column cannot have a default. Change its expression in the SQL console.`,
      )
    // PostgreSQL, CREATE TABLE, GENERATED … AS IDENTITY: "Such a column is implicitly NOT NULL."
    if (delta.nullable && draft.nullable && base.identity)
      throw new Error(
        `${base.name} is an identity column, which is implicitly NOT NULL — it cannot be made nullable. Drop the identity in the SQL console first.`,
      )
    if (delta.name && !mutations.renameColumn)
      throw new Error('Renaming columns is not supported by this driver')
    if (delta.type && !mutations.alterColumnType)
      throw new Error(
        `Changing existing column types is not supported for ${DATABASE_DRIVER_CATALOG[dialect].label}`,
      )
    if (delta.nullable && !mutations.alterColumnNullability)
      throw new Error(
        `Changing nullability is not supported for ${DATABASE_DRIVER_CATALOG[dialect].label}`,
      )
    if (delta.defaultValue && !mutations.alterColumnDefault)
      throw new Error(
        `Changing existing defaults is not supported for ${DATABASE_DRIVER_CATALOG[dialect].label}`,
      )
    const deltaCount = Object.values(delta).filter(Boolean).length
    if (deltaCount === 0) continue
    changeCount += deltaCount

    if (dialect === 'mysql') {
      // CHANGE/MODIFY would require every native column attribute to be restated and
      // silently drops omitted AUTO_INCREMENT/generated/comment/charset attributes.
      // Dedicated rename/default clauses change only what this normalized model owns.
      if (delta.name)
        mysqlRenames.push(
          `RENAME COLUMN ${quoteIdent(base.name, dialect)} TO ${quoteIdent(nextName, dialect)}`,
        )
      if (delta.defaultValue)
        mysqlDefaults.push(
          draft.defaultValue.trim()
            ? `ALTER COLUMN ${quoteIdent(nextName, dialect)} SET DEFAULT ${draft.defaultValue.trim()}`
            : `ALTER COLUMN ${quoteIdent(nextName, dialect)} DROP DEFAULT`,
        )
      continue
    }

    if (dialect === 'mssql' && delta.name) {
      const objectName = [table.schema, table.name, base.name]
        .filter((part): part is string => !!part)
        .map((part) => quoteIdent(part, 'mssql'))
        .join('.')
      statements.push(
        `EXEC sp_rename N${sqlString(objectName)}, N${sqlString(nextName)}, 'COLUMN';`,
      )
    } else if (delta.name) {
      statements.push(
        `ALTER TABLE ${target} RENAME COLUMN ${quoteIdent(base.name, dialect)} TO ${quoteIdent(nextName, dialect)};`,
      )
    }

    if (dialect === 'sqlite') continue

    if (dialect === 'mssql') {
      if (delta.type || delta.nullable)
        statements.push(
          `ALTER TABLE ${target} ALTER COLUMN ${quoteIdent(nextName, dialect)} ${draft.dataType.trim()} ${draft.nullable ? 'NULL' : 'NOT NULL'};`,
        )
    } else {
      if (delta.type)
        statements.push(
          `ALTER TABLE ${target} ALTER COLUMN ${quoteIdent(nextName, dialect)} TYPE ${draft.dataType.trim()};`,
        )
      if (delta.nullable)
        statements.push(
          `ALTER TABLE ${target} ALTER COLUMN ${quoteIdent(nextName, dialect)} ${draft.nullable ? 'DROP' : 'SET'} NOT NULL;`,
        )
      if (delta.defaultValue)
        statements.push(
          draft.defaultValue.trim()
            ? `ALTER TABLE ${target} ALTER COLUMN ${quoteIdent(nextName, dialect)} SET DEFAULT ${draft.defaultValue.trim()};`
            : `ALTER TABLE ${target} ALTER COLUMN ${quoteIdent(nextName, dialect)} DROP DEFAULT;`,
        )
    }
    if (delta.type)
      warnings.push(
        `Changing ${base.name}'s type can rewrite values; verify the conversion before running.`,
      )
  }

  const mysqlClauses = [...mysqlDrops, ...mysqlRenames, ...mysqlDefaults, ...mysqlAdds]
  if (mysqlClauses.length > 0)
    statements.push(`ALTER TABLE ${target}\n  ${mysqlClauses.join(',\n  ')};`)

  return {
    sql: statements.join('\n'),
    statements,
    changeCount,
    warnings: [...new Set(warnings)],
  }
}
