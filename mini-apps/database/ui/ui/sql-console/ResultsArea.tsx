/** The results half of the console: edit-error banner, the result-tab
 *  strip (draggable into chat), and the active tab's grid / Output log. */
import { Table2, Terminal } from 'lucide-react'
import { TabStrip, type StripTabItem } from '@localixai/kit/tabs'
import {
  createMessageBindingDraft,
  setMessageBindingDrag,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import type { SqlConsoleState } from '../../model/useSqlConsole'
import type { RowEditTarget } from '../../model/rowMutations'
import { tabToSnippet } from '../../model/resultSnippet'
import { SqlResultsView } from '../SqlResultsView'
import { OutputLogView } from '../OutputLogView'
import { useDbProblem } from '../../problems'

export function ResultsArea({
  c,
  editError,
  onDismissEditError,
  linkColumns,
  onCellLink,
  onCellFilter,
  onColumnFilter,
  pkColumns,
  edit,
  editable,
  editableColumns,
  onCommitChanges,
  connectionLabel,
}: {
  c: SqlConsoleState
  editError: string | null
  onDismissEditError: () => void
  linkColumns?: Set<string>
  onCellLink?: (columnId: string, value: unknown) => void
  onCellFilter?: (columnId: string, value: unknown) => void
  onColumnFilter?: (columnId: string, value: string) => void
  pkColumns?: Set<string>
  edit?: RowEditTarget
  editable: boolean
  editableColumns?: Set<string>
  onCommitChanges?: Parameters<typeof SqlResultsView>[0]['onCommitChanges']
  connectionLabel?: string
}) {
  const editProblem = useDbProblem(connectionLabel ?? 'this table', editError, {
    consequence: 'none',
    // Dismissing is only meaningful while looking at the strip; the centre row settles itself.
    actions: [{ id: 'dismiss', label: 'Dismiss', run: onDismissEditError, durable: false }],
  })
  // Result tabs: one tab per opened table / executed query (deduped in
  // the model) + a singleton Output log. The active tab drives the grid + edit + footer.
  const isOutput = c.active?.kind === 'output'
  const tabItems: StripTabItem[] = c.tabs.map((t) => {
    const lastErr = t.kind === 'output' && t.log?.[t.log.length - 1]?.status === 'error'
    return {
      id: t.id,
      label: t.label,
      title: t.kind === 'output' ? 'Output — affected rows, DDL messages, and errors' : t.sql,
      icon:
        t.kind === 'output' ? (
          <Terminal className="size-3 shrink-0" />
        ) : (
          <Table2 className="size-3 shrink-0" />
        ),
      badge: t.kind === 'output' && t.log ? t.log.length : undefined,
      badgeTone: lastErr ? 'error' : 'default',
      onClose: (id) => c.closeTab(id),
      onAuxClose: (id) => c.closeTab(id),
    }
  })

  // Drag ANY result tab into the chat composer — the same way editor tabs / files drag —
  // as an inline-content `snippet` ref: a query-result tab → its rows as a table, the
  // Output tab → the whole log. The TabStrip arms `draggable`; we set the payload here.
  const armTabDrag = (id: string, e: React.DragEvent) => {
    const tab = c.tabs.find((t) => t.id === id)
    const snip = tab && tabToSnippet(tab, connectionLabel)
    if (!snip) return // nothing linkable (e.g. a rows-affected / DDL outcome, or empty log)
    setMessageBindingDrag(
      e.dataTransfer,
      createMessageBindingDraft('snippet', snip.label, snip.label, {
        content: snip.content,
        language: 'text',
      }),
    )
    e.dataTransfer.setData('text/plain', snip.content) // plain-text fallback for any text field
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {editProblem && <ProblemLine {...editProblem} className="shrink-0 px-2 py-1" />}
        {c.tabs.length > 0 && (
          <TabStrip
            variant="compact"
            items={tabItems}
            activeId={c.activeTabId}
            onChange={c.activateTab}
            onItemDragStart={armTabDrag}
            aria-label="Query results"
          />
        )}
        <div className="min-h-0 min-w-0 flex-1">
          {isOutput ? (
            <OutputLogView log={c.active?.log ?? []} onClear={c.clearOutput} />
          ) : (
            <SqlResultsView
              // The grid owns a staged row-mutation ledger keyed by row object identity.
              // A result-tab switch or query refresh must discard that ledger before the
              // next table's edit handler is installed, or changes from table A can be
              // submitted through table B. `seq` changes on result reuse/refresh while the
              // stable id changes on tab activation.
              key={`${c.active?.id ?? 'empty'}:${c.active?.seq ?? 0}`}
              // Failures reach the Output tab here, never this grid — the subject is stated all
              // the same, so the day one does it is filed under this console and not shared.
              subject={`${connectionLabel ?? 'SQL'} console`}
              error={null}
              errorCode={null}
              outcome={c.outcome}
              rows={c.sortedRows}
              sort={c.sort}
              toggleSort={c.toggleSort}
              filter={c.filter}
              onFilterChange={c.setFilter}
              total={c.totalRows}
              linkColumns={linkColumns}
              onCellLink={onCellLink}
              onCellFilter={onCellFilter}
              onColumnFilter={onColumnFilter}
              pkColumns={pkColumns}
              edit={edit}
              editable={editable}
              editableColumns={editableColumns}
              onCommitChanges={onCommitChanges}
            />
          )}
        </div>
      </div>
    </div>
  )
}
