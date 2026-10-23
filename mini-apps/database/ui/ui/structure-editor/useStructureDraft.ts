/**
 * The structure editor's staged column drafts and the ALTER plan derived from them.
 *
 * Every input edits this in-memory draft; nothing reaches the engine until the generated script is
 * reviewed and applied. The draft survives a refresh of the same table (see `baseSignature`), and
 * a successful apply is the one event that clears it.
 */
import { useEffect, useMemo, useState } from 'react'
import { getDatabaseDriverManifest } from '../../../shared/driver-catalog'
import { databaseApi } from '../../api/databaseApi'
import type { DbConnectionInfo, DbTableSchema } from '../../dbClient'
import {
  buildAlterTablePlan,
  createAlterColumnDrafts,
  createNewColumnDraft,
  type AlterColumnDraft,
} from '../../model/alterTable'
import { withLiveConnection } from '../../model/withLiveConnection'
import { columnSignature } from './columnFacts'

export function useStructureDraft({
  connection,
  table,
  onApplied,
}: {
  connection: DbConnectionInfo
  table: DbTableSchema
  onApplied: () => void
}) {
  const manifest = getDatabaseDriverManifest(connection.dialect)
  const defaultType = manifest.schemaDataTypes[0] ?? 'TEXT'
  const [drafts, setDrafts] = useState(() => createAlterColumnDrafts(table))
  const analysis = useMemo(() => {
    try {
      return { plan: buildAlterTablePlan(connection.dialect, table, drafts), error: null }
    } catch (cause) {
      return {
        plan: { sql: '', statements: [], changeCount: 0, warnings: [], manualOnly: false },
        error: cause instanceof Error ? cause.message : 'Could not generate an ALTER script.',
      }
    }
  }, [connection.dialect, drafts, table])
  const fkColumns = useMemo(
    () => new Set(table.foreignKeys.flatMap((foreignKey) => foreignKey.columns)),
    [table.foreignKeys],
  )
  // The engine-side column, for the attributes this editor's normalized draft does not
  // model: a generated expression, an identity clause, a serial's owned sequence. They were
  // simply never read here, so a computed column looked exactly like a plain one — same
  // empty Default box, same editable checkbox — and editing it produced a plan the engine
  // refuses. See `buildAlterTablePlan`, which fails closed on the same two rules.
  const baseColumns = useMemo(
    () => new Map(table.columns.map((column) => [column.name, column])),
    [table.columns],
  )

  const patch = (id: string, next: Partial<AlterColumnDraft>) =>
    setDrafts((current) =>
      current.map((column) => (column.id === id ? { ...column, ...next } : column)),
    )
  const discard = (id: string) =>
    setDrafts((current) => current.filter((candidate) => candidate.id !== id))
  const reset = () => setDrafts(createAlterColumnDrafts(table))
  const addColumn = () =>
    setDrafts((current) => [
      ...current,
      createNewColumnDraft(`new:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`, defaultType),
    ])

  // The base column SET this draft was built against. A refresh of the SAME table replaces the `table`
  // object, and the effect below used to rebuild the drafts from it unconditionally — so every schema
  // reload silently threw away pending edits, and one fires on every switch INTO this view
  // (`TableDataWorkspace` reloads when `view` becomes 'structure' or 'ddl'). The header promises
  // "Changes stay staged until you review the SQL"; this is what makes that true.
  //
  // A different TABLE cannot reach here at all — the workspace keys this component on
  // `<schema>.<name>`, so it remounts — which is why dropping the blanket rebuild is safe.
  const [baseSignature, setBaseSignature] = useState(() => columnSignature(table))
  const liveSignature = columnSignature(table)
  const staleBase = analysis.plan.changeCount > 0 && liveSignature !== baseSignature

  useEffect(() => {
    // Rebuild only when nothing is staged: a refresh is then pure gain, and it is also how the editor
    // picks up an ALTER someone else ran. With edits pending the drafts stand, and `staleBase` tells the
    // user their diff is now against a changed base rather than letting it re-diff invisibly.
    if (analysis.plan.changeCount > 0) return
    setDrafts(createAlterColumnDrafts(table))
    setBaseSignature(liveSignature)
    // `analysis` is derived from `drafts`; depending on it here would re-run on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, liveSignature])

  const applyChanges = async () => {
    try {
      const statements = analysis.plan.statements.map((sql) => ({ sql }))
      await withLiveConnection(connection.id, () => databaseApi.batch(connection.id, statements))
    } catch (cause) {
      // The backend wraps a batch in a transaction, but DDL is not transactional on every
      // engine — MySQL/MariaDB implicitly commit each ALTER — so a rejected apply can still
      // have landed some of the statements. Re-read the table regardless of the outcome: the
      // staged drafts then re-diff against what is REALLY there (raising the changed-base
      // warning) instead of re-offering an ALTER that has already run and would fail again.
      onApplied()
      throw cause
    }
    // Explicit, because the effect above no longer rebuilds while changes are staged: after a
    // successful apply the staged set IS the new base, so it has to be cleared here or the same ALTER
    // would be offered again.
    setDrafts([])
    setBaseSignature('')
    onApplied()
  }

  return {
    manifest,
    drafts,
    analysis,
    fkColumns,
    baseColumns,
    staleBase,
    patch,
    discard,
    reset,
    addColumn,
    applyChanges,
  }
}

export type StructureDraft = ReturnType<typeof useStructureDraft>
