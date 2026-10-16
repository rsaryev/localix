/**
 * The cheap, model-facing payload. The agent gets dimensions + schema + a small
 * sample — never the whole table — so a 100k-row dataset costs ~nothing in tokens.
 */

import type { TableModel, TableRow } from './model'

export interface TableColumnSummary {
  id: string
  title: string
  type: string
}

export interface TableSummary {
  id: string
  title?: string
  rows: number
  cols: number
  columns: TableColumnSummary[]
  sample: TableRow[]
}

export function summarizeTable(model: TableModel, rows: TableRow[], sampleSize = 10): TableSummary {
  return {
    id: model.id,
    title: model.title,
    rows: model.rowCount,
    cols: model.columns.length,
    columns: model.columns.map((c) => ({ id: c.id, title: c.title, type: c.type })),
    sample: rows.slice(0, Math.max(0, sampleSize)),
  }
}

/** Compact text rendering of a summary — what a tool returns to the model. */
export function summaryToText(summary: TableSummary): string {
  const dims = `${summary.rows} rows × ${summary.cols} cols`
  const cols = summary.columns.map((c) => `${c.title} (${c.type})`).join(', ')
  const lines = [
    summary.title ? `Table "${summary.title}" — ${dims}` : `Table — ${dims}`,
    `Columns: ${cols}`,
  ]
  if (summary.sample.length > 0) {
    lines.push(`First ${summary.sample.length} row(s) as JSON:`)
    lines.push(JSON.stringify(summary.sample))
  }
  return lines.join('\n')
}
