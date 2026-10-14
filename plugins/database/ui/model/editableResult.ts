import type { TableColumn } from '@localixai/dataview'
import type { DbTableSchema } from '../dbClient'
import { defineRecordValue } from '../../shared/safe-record'
import type { EditableSelect } from './editableSelect'

export interface EditableResultMapping {
  /** Grid column id → real physical column name. Missing ids remain read-only. */
  sourceColumnById: Record<string, string>
  editableColumnIds: Set<string>
  pkColumnIds: Set<string>
}

function uniqueCaseInsensitiveMatch(names: string[], wanted: string): string | undefined {
  const exact = names.find((name) => name === wanted)
  if (exact) return exact
  const matches = names.filter((name) => name.toLowerCase() === wanted.toLowerCase())
  return matches.length === 1 ? matches[0] : undefined
}

/** Resolve parsed result labels against live introspection and require every PK exactly
 * once. This second stage prevents the SQL text alone from authorizing a mutation. */
export function mapEditableResult(
  analysis: EditableSelect,
  table: DbTableSchema,
  resultColumns: TableColumn[],
): EditableResultMapping | null {
  if (table.type !== 'table' || table.primaryKey.length === 0) return null
  const physicalNames = table.columns.map((column) => column.name)
  const sourceColumnById: Record<string, string> = {}
  const sourceCounts = new Map<string, number>()

  for (const column of resultColumns) {
    const declared = Object.entries(analysis.columns).find(
      ([resultName]) => resultName.toLowerCase() === column.title.toLowerCase(),
    )?.[1]
    const source = uniqueCaseInsensitiveMatch(
      physicalNames,
      declared ?? (analysis.wildcard ? column.title : ''),
    )
    if (!source) continue
    defineRecordValue(sourceColumnById, column.id, source)
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
  }

  // Duplicate projections of the same physical column are ambiguous in a staged grid.
  for (const [columnId, source] of Object.entries(sourceColumnById)) {
    if ((sourceCounts.get(source) ?? 0) > 1) delete sourceColumnById[columnId]
  }

  const pkColumnIds = new Set<string>()
  for (const pk of table.primaryKey) {
    const match = Object.entries(sourceColumnById).find(([, source]) => source === pk)
    if (!match) return null
    pkColumnIds.add(match[0])
  }

  return {
    sourceColumnById,
    editableColumnIds: new Set(Object.keys(sourceColumnById)),
    pkColumnIds,
  }
}
