import {
  cleanMiniAppQuery as cleanQuery,
  miniAppApiFetch,
  postMiniAppJson as postJson,
  unwrapMiniAppResponse as unwrap,
} from '@localixai/mini-app-sdk/ui/transport'
import type { OpenTargetsResponse, TableMeta, TableRowsResponse } from '../docClient'

export interface TableRowsQuery {
  offset?: number
  limit?: number
  /** Column id to sort by. */
  sort?: string
  dir?: 'asc' | 'desc'
  /** Free-text filter. */
  q?: string
  /** Restrict the filter to one column id. */
  qcol?: string
}

/**
 * REST client for the inspector Table tab (lazy rows, export, open-in-app).
 * Raw fetch (not the typed hono client): the `/rpc/table` routes are mounted by
 * the bundled documents MINI APP, so they are not part of core's `AppType`.
 */
export const tableApi = {
  async getMeta(id: string): Promise<TableMeta> {
    return unwrap<TableMeta>(await miniAppApiFetch(`/rpc/table/${encodeURIComponent(id)}`))
  },
  async getRows(id: string, query: TableRowsQuery = {}): Promise<TableRowsResponse> {
    const qs = new URLSearchParams(
      cleanQuery({
        offset: query.offset,
        limit: query.limit,
        sort: query.sort,
        dir: query.dir,
        q: query.q,
        qcol: query.qcol,
      }),
    ).toString()
    return unwrap<TableRowsResponse>(
      await miniAppApiFetch(`/rpc/table/${encodeURIComponent(id)}/rows${qs ? `?${qs}` : ''}`),
    )
  },
  async openTargets(): Promise<OpenTargetsResponse> {
    return unwrap<OpenTargetsResponse>(await miniAppApiFetch('/rpc/table/open-targets'))
  },
  /** Ingest a spreadsheet file (csv/xlsx) into a persisted table; returns its meta.
   *  Throws (via unwrap) on a non-tabular file or an unconfigured server. */
  async ingest(sessionId: string, path: string, format?: string): Promise<TableMeta> {
    return unwrap<TableMeta>(
      await postJson(
        '/rpc/table/ingest',
        format ? { sessionId, path, format } : { sessionId, path },
      ),
    )
  },
  /** Ingest a STORED file (dropped/uploaded, no host path) into a table by its media
   *  content id; `name` gives the table its title. Same pipeline as `ingest`. */
  async ingestMedia(sessionId: string, mediaId: string, name?: string): Promise<TableMeta> {
    return unwrap<TableMeta>(
      await postJson(
        '/rpc/table/ingest',
        name ? { sessionId, mediaId, name } : { sessionId, mediaId },
      ),
    )
  },
  async open(id: string, targetId: string): Promise<{ opened?: true; error?: string }> {
    return unwrap(await postJson(`/rpc/table/${encodeURIComponent(id)}/open`, { targetId }))
  },
  /** Mini-app-relative export route consumed by the host's download capability. */
  exportPath(id: string, format = 'csv'): string {
    return `/rpc/table/${id}/export?format=${encodeURIComponent(format)}`
  },
}
