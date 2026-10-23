/** Inline row editing + CSV import for the browsed table (PK-gated): builds PK-keyed
 *  UPDATE/INSERT/DELETE statements from staged grid changes and applies them as ONE
 *  atomic server-side batch; CSV import loads generated INSERTs into the editor. */
import { useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type { TableRow } from '@localixai/dataview'
import { adaptedCellValue, type AdaptedResult } from '../../model/resultAdapter'
import { databaseApi } from '../../api/databaseApi'
import {
  buildBoundDelete,
  buildBoundInsert,
  buildBoundUpdate,
  coerceMutationCell,
  type BoundMutationStatement,
  type RowEditTarget,
} from '../../model/rowMutations'
import { csvToInserts } from '../../model/csvImport'
import { withLiveConnection } from '../../model/withLiveConnection'
import { defineRecordValue, ownRecordValue } from '../../../shared/safe-record'

export function useRowEditing(opts: {
  edit: RowEditTarget | undefined
  result: AdaptedResult | null | undefined
  setSql: (sql: string) => void
}) {
  const { edit, result, setSql } = opts
  const [editError, setEditError] = useState<string | null>(null)

  // Import a CSV/TSV file into the open table: parse → generate INSERTs → load them into
  // the editor for review (never auto-run). Column names come from the CSV header row.
  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file || !edit) return
    const delimiter = /\.tsv$/i.test(file.name) ? '\t' : ','
    try {
      const { sql, rowCount } = csvToInserts(await file.text(), edit, delimiter)
      if (rowCount === 0) {
        setEditError('No data rows found in the file.')
        return
      }
      setEditError(null)
      setSql(sql)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Could not import the file.')
    }
  }

  // Inline row editing (fast path). The single-table + PK gate is `edit` (same as the
  // drawer). A table browser uses col.title as the physical name; an inferred query
  // result carries an explicit id→source map so aliases never leak into generated SQL.
  const sourceColumn = (columnId: string, fallbackTitle: string): string | undefined =>
    edit?.sourceColumnById ? ownRecordValue(edit.sourceColumnById, columnId) : fallbackTitle
  const pkValues = (row: TableRow): Record<string, unknown> => {
    const kv: Record<string, unknown> = {}
    if (!result) return kv
    for (const col of result.columns) {
      const source = sourceColumn(col.id, col.title)
      if (source && edit!.pk.includes(source)) {
        defineRecordValue(kv, source, adaptedCellValue(result, row, col.id))
      }
    }
    return kv
  }
  const softError = (e: unknown) => {
    acknowledgeInline(e)
    setEditError(e instanceof Error ? e.message : 'The change did not apply.')
  }

  // Commit a batch of staged changes (from the grid's Commit bar): build a PK-keyed UPDATE
  // per edited row (all its changed columns), then an INSERT per new row (blank cells omitted
  // so DB defaults / generated keys apply), then a PK-keyed DELETE per removed row — and apply
  // them as ONE atomic transaction server-side (all-or-nothing). On success the SELECT is
  // re-run to reflect the saved state (generated keys, defaults, removals).
  const commitChanges = async (changes: {
    updates: { row: TableRow; values: Record<string, string | null> }[]
    inserts: Record<string, string | null>[]
    deletes: TableRow[]
  }): Promise<boolean> => {
    if (!edit || !result) return false
    try {
      const statements: BoundMutationStatement[] = []
      for (const { row, values } of changes.updates) {
        const valuesMap: Record<string, unknown> = {}
        for (const [columnId, raw] of Object.entries(values)) {
          const col = result.columns.find((c2) => c2.id === columnId)
          const source = col ? sourceColumn(col.id, col.title) : undefined
          if (col && source) {
            defineRecordValue(
              valuesMap,
              source,
              raw === null ? null : coerceMutationCell(raw, col.type),
            )
          }
        }
        if (Object.keys(valuesMap).length === 0) continue
        statements.push(buildBoundUpdate(edit, valuesMap, pkValues(row)))
      }
      for (const values of changes.inserts) {
        const record: Record<string, unknown> = {}
        for (const col of result.columns) {
          const source = sourceColumn(col.id, col.title)
          if (!source) continue
          const raw = ownRecordValue(values, col.id)
          if (raw === null) defineRecordValue(record, source, null)
          else if (raw !== undefined && raw !== '') {
            defineRecordValue(record, source, coerceMutationCell(raw, col.type))
          }
        }
        statements.push(buildBoundInsert(edit, record))
      }
      for (const row of changes.deletes) {
        statements.push(buildBoundDelete(edit, pkValues(row)))
      }
      if (statements.length === 0) return true
      await withLiveConnection(edit.connectionId, () =>
        databaseApi.batch(edit.connectionId, statements),
      )
    } catch (e) {
      softError(e)
      return false
    }
    setEditError(null)
    edit.onCommitted() // re-run the SELECT to reflect the committed state
    return true
  }

  return { editError, setEditError, importCsv, commitChanges }
}
