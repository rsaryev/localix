import type { DbCheckConstraint, DbDialect, DbForeignKey, DbKeyConstraint } from './drivers/port'
import { quoteIdent } from './sql-ident'

/** Constraint clauses shared by CREATE builders and partition reconstruction. */
export function renderIndexKeys(
  columns: string[],
  dialect: DbDialect,
  orders?: Array<'asc' | 'desc'>,
  prefixLengths?: Array<number | null>,
): string {
  return columns
    .map((column, index) => {
      const prefix =
        dialect === 'mysql' && prefixLengths?.[index] != null ? `(${prefixLengths[index]})` : ''
      const order = orders?.[index] === 'desc' ? ' DESC' : ''
      return `${quoteIdent(column, dialect)}${prefix}${order}`
    })
    .join(', ')
}

export function renderForeignKey(
  foreignKey: DbForeignKey,
  dialect: DbDialect,
  qualify: (schema: string | undefined, name: string) => string,
): string {
  const q = (name: string) => quoteIdent(name, dialect)
  const name = foreignKey.name ? `CONSTRAINT ${q(foreignKey.name)} ` : ''
  const renderColumns = (columns: string[]) =>
    columns
      .map((column, index) => {
        const period =
          dialect === 'postgres' && foreignKey.period && index === columns.length - 1
            ? 'PERIOD '
            : ''
        return `${period}${q(column)}`
      })
      .join(', ')
  const referencedColumns =
    foreignKey.refColumns.length > 0 ? `(${renderColumns(foreignKey.refColumns)})` : ''
  const match =
    foreignKey.match && (dialect === 'postgres' || dialect === 'sqlite')
      ? ` MATCH ${foreignKey.match}`
      : ''
  const deleteColumns =
    dialect === 'postgres' && foreignKey.onDeleteColumns?.length
      ? ` (${foreignKey.onDeleteColumns.map(q).join(', ')})`
      : ''
  const onDelete = foreignKey.onDelete ? ` ON DELETE ${foreignKey.onDelete}${deleteColumns}` : ''
  const onUpdate = foreignKey.onUpdate ? ` ON UPDATE ${foreignKey.onUpdate}` : ''
  const notForReplication =
    dialect === 'mssql' && foreignKey.notForReplication ? ' NOT FOR REPLICATION' : ''
  const timing =
    (dialect === 'postgres' || dialect === 'sqlite') && foreignKey.deferrable
      ? ` DEFERRABLE INITIALLY ${foreignKey.initiallyDeferred ? 'DEFERRED' : 'IMMEDIATE'}`
      : ''
  const enforcement = dialect === 'postgres' && foreignKey.enforced === false ? ' NOT ENFORCED' : ''
  return `${name}FOREIGN KEY (${renderColumns(foreignKey.columns)}) REFERENCES ${qualify(foreignKey.refSchema, foreignKey.refTable)}${referencedColumns}${match}${onDelete}${onUpdate}${notForReplication}${timing}${enforcement}`
}

export function renderCheckConstraint(check: DbCheckConstraint, dialect: DbDialect): string {
  const q = (name: string) => quoteIdent(name, dialect)
  const name = check.name ? `CONSTRAINT ${q(check.name)} ` : ''
  const expression = check.expression.trim()
  const condition = expression.startsWith('(') ? expression : `(${expression})`
  const notForReplication =
    dialect === 'mssql' && check.notForReplication ? ' NOT FOR REPLICATION' : ''
  const noInherit = dialect === 'postgres' && check.noInherit ? ' NO INHERIT' : ''
  const enforcement = dialect === 'postgres' && check.enforced === false ? ' NOT ENFORCED' : ''
  return `${name}CHECK${notForReplication} ${condition}${noInherit}${enforcement}`
}

export function renderKeyConstraint(key: DbKeyConstraint, dialect: DbDialect): string {
  const q = (name: string) => quoteIdent(name, dialect)
  const name = key.name ? `CONSTRAINT ${q(key.name)} ` : ''
  const nulls =
    dialect === 'postgres' && key.type === 'UNIQUE' && key.nullsNotDistinct
      ? ' NULLS NOT DISTINCT'
      : ''
  const clustered =
    dialect === 'mssql' && key.clustered !== undefined
      ? key.clustered
        ? ' CLUSTERED'
        : ' NONCLUSTERED'
      : ''
  const columns =
    dialect === 'mssql'
      ? renderIndexKeys(key.columns, dialect, key.orders)
      : key.columns
          .map((column, index) => {
            const withoutOverlaps =
              dialect === 'postgres' && key.withoutOverlaps && index === key.columns.length - 1
                ? ' WITHOUT OVERLAPS'
                : ''
            return `${q(column)}${withoutOverlaps}`
          })
          .join(', ')
  const include =
    dialect === 'postgres' && key.includeColumns?.length
      ? ` INCLUDE (${key.includeColumns.map(q).join(', ')})`
      : ''
  const timing =
    dialect === 'postgres' && key.deferrable
      ? ` DEFERRABLE INITIALLY ${key.initiallyDeferred ? 'DEFERRED' : 'IMMEDIATE'}`
      : ''
  return `${name}${key.type}${nulls}${clustered} (${columns})${include}${timing}`
}
