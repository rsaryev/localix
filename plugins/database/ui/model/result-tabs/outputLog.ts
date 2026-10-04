import type { DbErrorCode } from '../../dbClient'

/** What a logged statement did — drives the Output line wording. */
export type OutputKind = 'select' | 'affected' | 'ddl' | 'error'

/** One line in the Output console log (every executed statement is logged). */
export interface OutputEntry {
  at: number
  /** Connection database/name, echoed as the `<db>>` prompt prefix. */
  db?: string
  sql: string
  durationMs: number
  status: 'ok' | 'error'
  /** What the statement did (drives the result-line wording). */
  kind: OutputKind
  /** Rows affected for a non-row 'ok' outcome (drives single-result consumers). */
  rowsAffected?: number
  /** Rows retrieved for a row-returning ('select') outcome. */
  rowCount?: number
  /** Result-line summary: "3 rows affected" / "3 rows retrieved" / "completed" / friendly error. */
  message: string
  /** Raw engine detail for a failure (e.g. "Duplicate entry '1' for key 'PRIMARY'"). */
  detail?: string
  errorCode?: DbErrorCode | null
}

/** Cap on retained Output log lines (oldest dropped). */
export const MAX_OUTPUT_ENTRIES = 200

/** Local absolute timestamp for a console line: `YYYY-MM-DD HH:MM:SS` (not relative). */
export function formatSqlTimestamp(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** The result/error line for a console entry (the error prefers the raw engine `detail`). */
export function outputResultText(entry: OutputEntry): string {
  return entry.status === 'error' ? (entry.detail ?? entry.message) : entry.message
}

/** Compact duration for a console line: `12 ms` under a second, `1.20 s` above. */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

/** The full result line for one entry: the engine reason on error, else "<summary> in <ms>". */
export function outputEntryResultLine(entry: OutputEntry): string {
  const text = outputResultText(entry)
  return entry.status === 'error' ? text : `${text} in ${formatDurationMs(entry.durationMs)}`
}

/**
 * Render the whole Output console log as PLAIN TEXT — the same timestamped
 * `[ts] <db>> <sql>` / `[ts] <result>` shape the OutputLogView shows visually, for
 * capturing the log as a chat `snippet` context-ref. Entries in log order (newest
 * last), blank-line separated. Empty log → ''.
 */
export function formatOutputLogText(log: OutputEntry[]): string {
  return log
    .map((entry) => {
      const ts = formatSqlTimestamp(entry.at)
      const prompt = `${entry.db ?? 'sql'}>`
      return `[${ts}] ${prompt} ${entry.sql}\n[${ts}] ${outputEntryResultLine(entry)}`
    })
    .join('\n\n')
}
