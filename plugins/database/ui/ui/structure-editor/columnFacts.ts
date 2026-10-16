/** Pure facts about one structure-editor row: its diff status against the base table, what the
 * engine fills in for it, and the identity of the base column set a draft was built against. */
import { Hash, Sigma } from 'lucide-react'
import type { DbColumn, DbTableSchema } from '../../dbClient'
import type { AlterColumnDraft } from '../../model/alterTable'

export type ColumnRowStatus = 'discarded' | 'added' | 'removed' | 'modified' | 'unchanged'

const baseDefault = (value: string | null | undefined) => value?.trim() ?? ''

/** Identity of the base column set — what a draft was built against, for detecting a changed base. */
export function columnSignature(table: DbTableSchema): string {
  return table.columns
    .map((column) =>
      [column.name, column.dataType.trim(), column.nullable, baseDefault(column.defaultValue)].join(
        '\u0000',
      ),
    )
    .join('\u0001')
}

export function rowStatus(column: AlterColumnDraft, table: DbTableSchema): ColumnRowStatus {
  if (!column.originalName) return column.deleted ? 'discarded' : 'added'
  if (column.deleted) return 'removed'
  const base = table.columns.find((candidate) => candidate.name === column.originalName)
  if (
    base &&
    (base.name !== column.name.trim() ||
      base.dataType.trim() !== column.dataType.trim() ||
      base.nullable !== column.nullable ||
      baseDefault(base.defaultValue) !== column.defaultValue.trim())
  )
    return 'modified'
  return 'unchanged'
}

/**
 * How the engine fills this column, when it fills it itself. `DbColumn` carries these
 * three attributes and the editor read none of them, so an identity/computed/serial column
 * was indistinguishable from a plain one — its Default box simply looked empty.
 *
 * Returns the badge + the label shown INSIDE the empty default field, so the reason is
 * readable without hovering.
 */
export function engineFilledColumn(
  column: DbColumn | undefined,
): { icon: typeof Sigma; badge: string; title: string; emptyLabel: string } | null {
  if (column?.generated)
    return {
      icon: Sigma,
      badge: 'computed',
      title: `Generated column — GENERATED ALWAYS AS (${column.generated.expression}) ${column.generated.storage}`,
      emptyLabel: `computed: ${column.generated.expression}`,
    }
  if (column?.identity)
    return {
      icon: Hash,
      badge: 'identity',
      title: `Identity column — GENERATED ${column.identity.generation} AS IDENTITY${
        column.identity.sequence ? ` (sequence ${column.identity.sequence.name})` : ''
      }`,
      emptyLabel: `identity: GENERATED ${column.identity.generation}`,
    }
  if (column?.ownedSequence)
    return {
      icon: Hash,
      badge: 'serial',
      // Editable on purpose: dropping the default is legal SQL. It just orphans the
      // sequence and silently stops auto-numbering, so the sequence is named up front.
      title: `Serial column — values come from sequence ${column.ownedSequence.name}. Clearing this default stops auto-numbering.`,
      emptyLabel: 'No default',
    }
  return null
}
