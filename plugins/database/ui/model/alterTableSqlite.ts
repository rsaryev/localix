import { stripStatementTerminator } from '../../shared/sql-text'
import type { DbTableSchema } from '../dbClient'
import type { AlterColumnDraft, AlterTablePlan } from './alterTable'
import { changed, qualifiedTable } from './alterTableColumns'
import { quoteIdent } from './sqlIdent'

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

export function sqliteRebuildRequired(table: DbTableSchema, drafts: AlterColumnDraft[]): boolean {
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
export function buildSqliteRebuildPlan(
  table: DbTableSchema,
  drafts: AlterColumnDraft[],
): AlterTablePlan {
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
        statements.push(`${stripStatementTerminator(index.createScript)};`)
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
        const normalized = stripStatementTerminator(script)
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
