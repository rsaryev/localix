import { useMemo, useRef, useState } from 'react'
import { Leaf, Table2, Braces, type LucideIcon } from 'lucide-react'
import { CodeEditor, type CompletionSource, type EditorHandle } from '@localixai/kit/code-editor'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { SqlResultsView } from './SqlResultsView'
import { JsonTree } from '@localixai/kit/json-tree'
import { rowsToDocuments } from '../model/rowsToDocuments'
import type { SqlConsoleState } from '../model/useSqlConsole'
import type { useSqlHistory } from '../model/useSqlHistory'
import { docCompletionItems } from '../model/docMethodCompletion'
import { DocHistoryPopover } from './doc-console/DocHistoryPopover'
import { RunButton, StopButton } from './consoleActions'

/**
 * Shared multi-line JSON command console for the non-SQL "query a body" engines — MongoDB
 * (`db.<collection>.<method>(…)`) and Elasticsearch (`<index>.<method>(…)`). A command box runs
 * on ⌘/Ctrl+Enter and renders the result in the shared grid; engine-specific completions run
 * through the shared editor while SQL-only EXPLAIN and row editing stay out of this surface.
 */
const NO_NAMES: string[] = []

export function DocConsole({
  console: c,
  connectionId,
  dbLabel,
  history,
  icon: Icon = Leaf,
  placeholder = 'db.users.find({"age":{"$gt":20}})   ·   ⌘/Ctrl+Enter to run',
  historyLabel = 'Recent queries',
  emptyHint = 'Run a query to see documents.',
  methods = NO_NAMES,
  collections = NO_NAMES,
}: {
  console: SqlConsoleState
  connectionId: string
  /** The tab's own title — the identity a failed query is filed under. */
  dbLabel?: string
  history: ReturnType<typeof useSqlHistory>
  icon?: LucideIcon
  placeholder?: string
  historyLabel?: string
  emptyHint?: string
  /** Engine method names for `<name>.<method>` autocomplete (Mongo/ES verbs). */
  methods?: string[]
  /** Collection/index names for `<name>` autocomplete (from the connection's schema). */
  collections?: string[]
}) {
  const [view, setView] = useState<'grid' | 'json'>('grid')
  const editorRef = useRef<EditorHandle | null>(null)
  const completionSource = useMemo<CompletionSource>(
    () => async (position) => docCompletionItems(c.sql, position, methods, collections),
    [c.sql, methods, collections],
  )
  const run = () => {
    const selected = editorRef.current?.getSelectedText()
    if (selected?.trim()) void c.runSql(selected)
    else void c.run()
  }

  // JSON view: reconstruct documents from the flat result (nested cells parsed back). Only
  // meaningful when there's a row result; falls back to the grid otherwise.
  const result = c.outcome?.result
  const docs = useMemo(
    () => (result ? rowsToDocuments(result.columns, c.sortedRows) : []),
    [result, c.sortedRows],
  )
  const showJson = view === 'json' && !!result && !c.error

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-1.5 border-b border-border-soft px-2 py-1.5">
        <Icon className="mt-1.5 size-3.5 shrink-0 text-text-faint" />
        {/* The shared field fill (see the host's choice-trigger.ts): a foreground veil, not
            `--input`, which is an opaque grey in the plain dark theme and read as a black bar. */}
        <div className="h-24 min-h-[3rem] min-w-0 flex-1 resize-y overflow-hidden rounded-md border border-border bg-foreground/[0.04] transition-colors focus-within:border-control-border-focus">
          <CodeEditor
            value={c.sql}
            language="javascript"
            onChange={c.setSql}
            onSubmit={run}
            submitActionLabel="Run Selection or Command"
            completionSource={completionSource}
            onEditorReady={(api) => (editorRef.current = api)}
            placeholder={placeholder}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- CodeEditor's own prop: it focuses Monaco once the editor is ready, no DOM autofocus attribute is set
            autoFocus
            ariaLabel="Database command editor"
            className="h-full"
          />
        </div>
        {result && (
          // The same shared grid↔alternate-view toggle ResultToolbar uses (muted track,
          // h-6/h-5 icon items) — not a bespoke button pair.
          <SegmentedControl variant="muted" className="h-6 p-0.5" aria-label="Result view">
            <SegmentedControlItem
              className="h-5 px-1"
              active={view === 'grid'}
              title="Table view"
              onClick={() => setView('grid')}
            >
              <Table2 className="size-3" />
            </SegmentedControlItem>
            <SegmentedControlItem
              className="h-5 px-1"
              active={view === 'json'}
              title="JSON view"
              onClick={() => setView('json')}
            >
              <Braces className="size-3" />
            </SegmentedControlItem>
          </SegmentedControl>
        )}
        <DocHistoryPopover history={history} historyLabel={historyLabel} onPick={c.setSql} />
        {c.running ? (
          <StopButton onClick={c.cancel} />
        ) : (
          <RunButton
            running={false}
            onClick={run}
            disabled={!c.sql.trim()}
            title="Run query (⌘/Ctrl+Enter)"
          />
        )}
      </div>

      <div className="min-h-0 flex-1">
        {showJson ? (
          <div className="h-full overflow-auto px-2 py-2 scrollbar-thin">
            <JsonTree value={docs} expandDepth={2} />
          </div>
        ) : (
          <SqlResultsView
            subject={`${dbLabel ?? connectionId} console`}
            error={c.error}
            errorCode={c.errorCode}
            outcome={c.outcome}
            rows={c.sortedRows}
            sort={c.sort}
            toggleSort={c.toggleSort}
            filter={c.filter}
            onFilterChange={c.setFilter}
            total={c.totalRows}
            emptyHint={emptyHint}
          />
        )}
      </div>
    </div>
  )
}
