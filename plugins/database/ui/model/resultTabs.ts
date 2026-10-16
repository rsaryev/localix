import type { SortSpec } from '@localixai/dataview'
import type { AdaptedResult } from './resultAdapter'
import { MAX_OUTPUT_ENTRIES, type OutputEntry } from './result-tabs/outputLog'
import { maskSqlNonCode, REDACTION_SQL_GRAMMAR, scanSqlRegions } from '../../shared/sql-regions'

/**
 * Pure state model for the SQL console's result tabs. Each executed
 * SELECT / opened table gets its own result tab; non-row outcomes (rows-affected,
 * DDL messages, errors) append to a SINGLETON "Output" text-log tab. Kept free of
 * React so the dedup / eviction logic is unit-testable in isolation. The Output-log
 * entry shape + text rendering live in ./result-tabs/outputLog.
 */

export {
  formatDurationMs,
  formatOutputLogText,
  formatSqlTimestamp,
  outputEntryResultLine,
  outputResultText,
} from './result-tabs/outputLog'
export type { OutputEntry } from './result-tabs/outputLog'

/** Stable id of the singleton Output log tab. */
export const OUTPUT_TAB_ID = '__output__'

/**
 * Cap on open RESULT tabs (the Output singleton is never counted / evicted). When a
 * new distinct result would exceed this, the oldest result tab is evicted (LRU by the
 * monotonic `seq`). Enough to keep several queries side by side without
 * the strip growing unbounded.
 */
export const MAX_RESULT_TABS = 12

export interface ResultOutcome {
  result: AdaptedResult | null
  rowsAffected?: number
  /** A schema change (CREATE/ALTER/DROP…): its row count is meaningless, so it reads "completed" —
   *  "0 affected" after a CREATE TABLE read as if nothing had happened. */
  ddl?: boolean
  durationMs: number
}

export type ResultTabKind = 'result' | 'output'

export interface ResultTab {
  id: string
  kind: ResultTabKind
  label: string
  /** Monotonic recency stamp — drives LRU eviction + "activate most-recent on close". */
  seq: number
  // result-only
  sql?: string
  /** The browsed-table target this tab maps to (drives per-tab row-edit gating), or null. */
  browse?: { table: string; schema?: string } | null
  /** Active drill/filter WHERE-predicate stack that produced this view (for the chip + Back). */
  filters?: string[]
  outcome?: ResultOutcome
  sort?: SortSpec
  filter?: string
  // output-only
  log?: OutputEntry[]
}

export interface ResultTabsState {
  tabs: ResultTab[]
  activeId: string | null
  /** Next recency stamp to hand out (monotonic; only ever increments). */
  nextSeq: number
}

export function emptyResultTabsState(): ResultTabsState {
  return { tabs: [], activeId: null, nextSeq: 1 }
}

/** Collapse whitespace and lowercase CODE only; literals, quoted names and comments stay as typed. */
function normalizeCode(code: string): string {
  return code.replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Trim + collapse whitespace + lowercase + drop a trailing `;` — the identity of an ad-hoc query,
 * so re-running the same SQL reuses its tab. Only code is folded: `WHERE name = 'Bob'` and
 * `'bob'` (or `"User"` and `"user"`) are different queries and must not share a tab. The
 * string-greedy redaction grammar is used because the dialect is unknown here.
 */
export function normalizeSql(sql: string): string {
  const text = sql.trim().replace(/;\s*$/, '')
  let out = ''
  let at = 0
  for (const region of scanSqlRegions(text, REDACTION_SQL_GRAMMAR)) {
    out += normalizeCode(text.slice(at, region.start)) + text.slice(region.start, region.end)
    at = region.end
  }
  return (out + normalizeCode(text.slice(at))).trim()
}

/** The first `FROM` outside literals, comments and parentheses (a select-list subquery). */
function topLevelFrom(one: string): RegExpExecArray | null {
  const code = maskSqlNonCode(one, REDACTION_SQL_GRAMMAR)
  let depth = 0
  for (let index = 0; index < code.length; index++) {
    const ch = code[index]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (
      depth === 0 &&
      /^from\b/i.test(code.slice(index, index + 5)) &&
      !/\w/.test(code[index - 1] ?? '')
    ) {
      return /^from\s+([`"[\]\w.]+)/i.exec(one.slice(index))
    }
  }
  return null
}

/** Identity key for a browsed-table tab (schema-qualified). */
export function tableKey(table: string, schema?: string): string {
  return `t:${schema ?? ''}.${table}`
}

/** Identity key for an ad-hoc query tab. */
export function sqlKey(sql: string): string {
  return `q:${normalizeSql(sql)}`
}

/**
 * A short human label for an ad-hoc query tab. Prefers `SELECT <table>` when a FROM
 * clause is present, else a truncated one-line form of the SQL.
 */
export function deriveSqlLabel(sql: string): string {
  const one = sql.trim().replace(/\s+/g, ' ')
  const from = topLevelFrom(one)
  if (/^select\b/i.test(one) && from) {
    const table = from[1].replace(/[`"[\]]/g, '')
    return `SELECT ${table}…`
  }
  return one.length > 28 ? `${one.slice(0, 28)}…` : one || 'Query'
}

interface OpenResultInput {
  key: string
  label: string
  sql: string
  browse: { table: string; schema?: string } | null
  filters?: string[]
  outcome: ResultOutcome
}

/**
 * Open a result tab, or REUSE + refresh an existing one with the same identity key
 * (no duplicate tabs for the same table / query). On reuse the outcome/sql/label are
 * replaced and per-tab sort+filter reset (a refresh); the tab is re-activated. On a
 * new tab, evict the oldest result tab first when at {@link MAX_RESULT_TABS}.
 */
export function openOrReuseResult(state: ResultTabsState, input: OpenResultInput): ResultTabsState {
  const seq = state.nextSeq
  const existing = state.tabs.find((t) => t.id === input.key)
  if (existing) {
    const tabs = state.tabs.map((t) =>
      t.id === input.key
        ? {
            ...t,
            label: input.label,
            sql: input.sql,
            browse: input.browse,
            filters: input.filters,
            outcome: input.outcome,
            sort: undefined,
            filter: '',
            seq,
          }
        : t,
    )
    return { tabs, activeId: input.key, nextSeq: seq + 1 }
  }
  const newTab: ResultTab = {
    id: input.key,
    kind: 'result',
    label: input.label,
    sql: input.sql,
    browse: input.browse,
    filters: input.filters,
    outcome: input.outcome,
    sort: undefined,
    filter: '',
    seq,
  }
  let tabs = [...state.tabs, newTab]
  const resultTabs = tabs.filter((t) => t.kind === 'result')
  if (resultTabs.length > MAX_RESULT_TABS) {
    // Evict the least-recently-touched result tab (never the Output singleton, never
    // the one we just added). LRU by seq.
    const victim = resultTabs
      .filter((t) => t.id !== input.key)
      .reduce((oldest, t) => (t.seq < oldest.seq ? t : oldest))
    tabs = tabs.filter((t) => t.id !== victim.id)
  }
  return { tabs, activeId: input.key, nextSeq: seq + 1 }
}

/**
 * Append a line to the singleton Output tab (creating it if absent). EVERY executed
 * statement is logged — a row-returning SELECT is logged with `activate: false` so its
 * own result tab keeps focus, while non-row outcomes / DDL / errors activate the Output
 * log (`activate: true`, the default) so the outcome is visible.
 */
export function appendOutput(
  state: ResultTabsState,
  entry: OutputEntry,
  activate = true,
): ResultTabsState {
  const seq = state.nextSeq
  const existing = state.tabs.find((t) => t.id === OUTPUT_TAB_ID)
  const activeId = activate ? OUTPUT_TAB_ID : state.activeId
  if (existing) {
    const log = [...(existing.log ?? []), entry].slice(-MAX_OUTPUT_ENTRIES)
    const tabs = state.tabs.map((t) => (t.id === OUTPUT_TAB_ID ? { ...t, log, seq } : t))
    return { tabs, activeId, nextSeq: seq + 1 }
  }
  const outputTab: ResultTab = {
    id: OUTPUT_TAB_ID,
    kind: 'output',
    label: 'Output',
    seq,
    log: [entry],
  }
  return { tabs: [...state.tabs, outputTab], activeId, nextSeq: seq + 1 }
}

/** Empty the Output log (keep the tab). No-op when there is no Output tab. */
export function clearOutput(state: ResultTabsState): ResultTabsState {
  if (!state.tabs.some((t) => t.id === OUTPUT_TAB_ID)) return state
  return { ...state, tabs: state.tabs.map((t) => (t.id === OUTPUT_TAB_ID ? { ...t, log: [] } : t)) }
}

/** Activate a tab by id (no-op if it doesn't exist). */
export function activateTab(state: ResultTabsState, id: string): ResultTabsState {
  if (!state.tabs.some((t) => t.id === id)) return state
  return { ...state, activeId: id }
}

/**
 * Close a tab. When the closed tab was active, activate the most-recently-touched
 * remaining tab (highest seq), or null when none remain.
 */
export function closeTab(state: ResultTabsState, id: string): ResultTabsState {
  const tabs = state.tabs.filter((t) => t.id !== id)
  if (tabs.length === state.tabs.length) return state
  let activeId = state.activeId
  if (activeId === id) {
    activeId = tabs.length > 0 ? tabs.reduce((a, t) => (t.seq > a.seq ? t : a)).id : null
  }
  return { ...state, tabs, activeId }
}

/** The currently-active tab (or null). */
export function activeTab(state: ResultTabsState): ResultTab | null {
  return state.tabs.find((t) => t.id === state.activeId) ?? null
}
