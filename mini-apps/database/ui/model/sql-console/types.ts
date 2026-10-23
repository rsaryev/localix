import type { SortSpec } from '@localixai/dataview'
import type { DbDialect, DbErrorCode } from '../../dbClient'
import type { AdaptedResult } from '../resultAdapter'
import type { ResultOutcome, ResultTab } from '../resultTabs'
import type { ParamField } from '../sqlParams'
import type { SqlRunFailure } from '../sql-diagnostics/run-error'

/**
 * Metadata attached to a run so its result lands in the right tab. When `asTable` is set
 * (opening / reopening a browsed table, or clearing its filters), the tab is keyed by the
 * schema+table so re-opening reuses it; otherwise it is keyed by the normalized SQL so
 * re-running the same query reuses its tab. `browse`/`filters` are per-tab metadata that
 * drive row-edit gating + the drill filter chip.
 */
export interface RunMeta {
  asTable?: boolean
  browse?: { table: string; schema?: string } | null
  filters?: string[]
  label?: string
  /** Whether to overwrite the editor text with the run SQL. Defaults to true (the
   *  single-command non-SQL consoles want the box to show what ran). The SQL console sets
   *  it FALSE for opening a table / drilling a filter, so those never wipe the user's
   *  in-progress query — the result lands in its own tab instead. */
  replaceEditor?: boolean
}

export interface SqlConsoleState {
  /**
   * The connection this console runs on. Exposed because surfaces built AROUND the console
   * need to name it — e.g. as `@resource:localix://resource/db/<id>` — and threading the same
   * id through every intermediate component would just duplicate what the console holds.
   */
  connectionId: string
  sql: string
  setSql: (next: string) => void
  running: boolean
  error: string | null
  /** Typed error code from the backend (e.g. 'cancelled', 'timeout', 'syntax_error'). */
  errorCode: DbErrorCode | null
  /** Raw engine detail for the last failure (e.g. duplicate-key text), or null. */
  errorDetail: string | null
  /**
   * The statement that failed last and the engine's text for it — what the editor needs to
   * underline the offending name. Cleared with the error, by the next run or a reconnect.
   */
  lastFailure: SqlRunFailure | null
  /** Abort the in-flight query on this connection (server-side). */
  cancel: () => void
  outcome: ResultOutcome | null
  sortedRows: AdaptedResult['rows']
  sort: SortSpec | undefined
  toggleSort: (columnId: string) => void
  /** Client-side result filter (substring across all columns). */
  filter: string
  setFilter: (query: string) => void
  /** Row count before the client-side filter (drives a "N of M" status). */
  totalRows: number
  /** Run the current editor text. Resolves true on success, false on error/no-op. */
  run: () => Promise<boolean>
  /** Run an explicit statement WITHOUT changing the editor (e.g. run the selection). */
  runSql: (text: string, meta?: RunMeta) => Promise<boolean>
  /** Run every top-level statement in the editor in order, stopping at the first failure. */
  runAll: () => Promise<void>
  /** Replace the editor text and immediately run it (schema-tree "open table"). */
  runText: (text: string, meta?: RunMeta) => Promise<void>
  /** Latest editor text (from a ref) — for the autocomplete source without a stale closure. */
  getText: () => string
  /** Current parameter values, keyed via {@link paramKey}. */
  paramValues: Record<string, string>
  /** Set one remembered parameter value in the pending-run dialog. */
  setParam: (key: string, value: string) => void
  /** Parameters detected for a requested run, or null when no confirmation is needed. */
  parameterPrompt: { sql: string; fields: ParamField[] } | null
  /** Confirm the pending values and execute the statement. */
  submitParameters: () => Promise<void>
  /** Cancel the pending run without executing it. */
  cancelParameters: () => void
  /**
   * Optimistically transform the active result tab's rows in place (e.g. an inline cell
   * edit, a delete, or an append). Returns a revert fn that restores the exact prior
   * result — call it if the backing mutation fails. No-op when there is no active result.
   */
  patchResultRows: (updater: (rows: AdaptedResult['rows']) => AdaptedResult['rows']) => () => void
  // --- Result tabs ---
  /** All open result tabs + the singleton Output log, oldest→newest. */
  tabs: ResultTab[]
  /** Id of the active tab (drives the grid + row-edit + footer chrome), or null. */
  activeTabId: string | null
  /** The active tab (null when none). */
  active: ResultTab | null
  activateTab: (id: string) => void
  closeTab: (id: string) => void
  /** Empty the Output console log (keeps the tab). */
  clearOutput: () => void
  /** Re-run the active tab's own SQL, refreshing it in place (e.g. after a Commit). */
  refreshActive: () => Promise<void>

  // --- Manual transaction mode ("Tx: Auto / Manual") ---
  /** 'auto' = each statement auto-commits; 'manual' = statements share one open tx. */
  txMode: 'auto' | 'manual'
  /** Switch tx mode. Switching to 'auto' while a tx is open is a no-op (Commit/Rollback first). */
  setTxMode: (mode: 'auto' | 'manual') => void
  /** True while a manual transaction is open on this connection. */
  txOpen: boolean
  /** True while a begin/commit/rollback request is in flight. */
  txBusy: boolean
  /** Latest transaction transition note (BEGIN / COMMIT / ROLLBACK) for the output log. */
  txNotice: string | null
  /** COMMIT the open manual transaction. */
  commitTx: () => Promise<void>
  /** ROLLBACK the open manual transaction. */
  rollbackTx: () => Promise<void>
}

/**
 * SQL-console state for one connection: editor text, run lifecycle, and a set of
 * RESULT TABS (each executed SELECT / opened table its own tab; non-row
 * outcomes + errors append to a singleton Output log). The active tab drives the shared
 * grid, sort/filter, inline editing, and footer. Lifted out of the view so the schema
 * sidebar can drive it. Whole result held client-side — server paging is a later step.
 */
export interface UseSqlConsoleOptions {
  /** Called with the statement after it runs successfully (e.g. to record history). */
  onExecuted?: (sql: string) => void
  /** Dialect for compiling `?`/`:name` placeholders to native binding. Omit → no params. */
  dialect?: DbDialect
  /** When set, the editor draft is persisted under this key and restored across restarts. */
  draftKey?: string
  /** Connection database/name, echoed as the `<db>>` prompt prefix in the Output log. */
  dbLabel?: string
}
