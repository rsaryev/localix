import { z } from 'zod'
import type { ChartSpec, TableColumn, TableRow, ViewKind } from '@localixai/dataview'

export const rowsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  /** Column id to sort by. */
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  /** Free-text filter query. */
  q: z.string().optional(),
  /** Restrict the filter to one column id. */
  qcol: z.string().optional(),
})

export const exportQuerySchema = z.object({
  format: z.string().optional(),
})

export const openBodySchema = z.object({
  targetId: z.string().min(1),
})

/** Open a spreadsheet file (csv/xlsx) as a persisted table (server extracts + saves). */
export const ingestBodySchema = z
  .object({
    sessionId: z.string().min(1),
    /** Absolute path to the source file on the API host. */
    path: z.string().min(1).optional(),
    /** Content id of a stored (e.g. dropped/uploaded) file — the web open-as-table path. */
    mediaId: z.string().min(1).optional(),
    /** Original filename (drives the table title for a mediaId ingest). */
    name: z.string().min(1).optional(),
    /** Override the auto-detected format (e.g. 'csv' / 'xlsx'). */
    format: z.string().min(1).optional(),
  })
  // Exactly one source — an absolute path OR a stored media id.
  .refine((v) => Boolean(v.path) !== Boolean(v.mediaId), {
    message: 'provide either path or mediaId',
  })

/** Table metadata (no rows) — drives the tab's columns/view/chart on restore. */
export interface TableMeta {
  id: string
  title?: string
  columns: TableColumn[]
  rowCount: number
  view: ViewKind
  chart?: ChartSpec
}

export interface TableRowsResponse {
  rows: TableRow[]
  /** Total rows after filtering — for sizing the virtual scroller. */
  total: number
  offset: number
  limit: number
}

export interface OpenTargetView {
  id: string
  label: string
}

export interface OpenTargetsResponse {
  targets: OpenTargetView[]
}
