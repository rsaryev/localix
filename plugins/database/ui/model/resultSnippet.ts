// Format a query result as a compact, tab-separated text snippet for the chat composer —
// the counterpart to formatOutputLogText, so a result grid can be dragged into chat and
// linked to the agent as an inline-content `snippet` context-ref (no server round-trip).
// Cells go through dataview's formatCell (objects→JSON, binary→bounded hex), and the row
// set is capped so a huge result can't blow the composer.
import { formatCell, type TableRow } from '@localixai/dataview'
import { formatOutputLogText, type ResultTab } from './resultTabs'

/** Rows included before truncating with a "… N more" note — keeps the snippet bounded. */
export const MAX_SNIPPET_ROWS = 200

export function formatResultSnippet(
  columns: ReadonlyArray<{ id: string; title: string }>,
  rows: ReadonlyArray<TableRow>,
  opts?: { label?: string },
): string {
  const header = columns.map((c) => c.title).join('\t')
  const shown = rows.slice(0, MAX_SNIPPET_ROWS)
  const body = shown.map((r) => columns.map((c) => formatCell(r[c.id])).join('\t')).join('\n')
  const more =
    rows.length > MAX_SNIPPET_ROWS
      ? `\n… ${rows.length - MAX_SNIPPET_ROWS} more rows (showing ${MAX_SNIPPET_ROWS})`
      : ''
  const table = body ? `${header}\n${body}${more}` : header
  return opts?.label ? `${opts.label}\n\n${table}` : table
}

/**
 * Map a console result TAB to a chat snippet (label + content), or `null` when there's
 * nothing to link — a rows-affected / DDL outcome with no grid, or an empty Output log.
 * The Output tab → the whole log; a query-result tab → its rows as a table. Keeps the
 * tab-drag mapping pure + tested (the SqlConsole drag handler just arms this).
 */
export function tabToSnippet(
  tab: ResultTab,
  connectionLabel?: string,
): { label: string; content: string } | null {
  const conn = connectionLabel ?? 'SQL'
  if (tab.kind === 'output') {
    const content = formatOutputLogText(tab.log ?? [])
    return content ? { label: `Output — ${conn}`, content } : null
  }
  const result = tab.outcome?.result
  if (!result) return null
  const label = `${tab.label} — ${conn}`
  const table = formatResultSnippet(result.columns, result.rows)
  // The statement that produced the rows: without it the agent sees values but not what they
  // answer, and the tab label is a shortened form of the query, not the query.
  const query = tab.sql?.trim() ? `Query:\n${tab.sql.trim()}\n\n` : ''
  return { label, content: `${label}\n\n${query}${table}` }
}
