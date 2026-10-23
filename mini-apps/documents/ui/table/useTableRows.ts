import { useCallback, useEffect, useRef, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type { SortSpec, TableRow } from '@localixai/dataview'
import { tableApi } from '../api/tableApi'
import { documentFailure } from '../failure'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

const PAGE = 500

export interface TableQueryState {
  sort?: SortSpec
  /** Free-text filter. */
  q: string
  /** Restrict the filter to one column id. */
  qcol?: string
}

export interface UseTableRows {
  rows: TableRow[]
  total: number
  loading: boolean
  /** Why the page could not be read, in the two halves the report has room for. */
  error: { message: string; detail?: string } | null
  /** Append the next page (no-op while loading or fully loaded). */
  loadMore: () => void
}

/**
 * Lazy, server-paged rows. Page 0 (re)loads whenever the table or the
 * sort/filter changes; `loadMore` appends the next page as the grid scrolls.
 * Sort/filter run server-side so they cover the whole dataset, not just what's
 * loaded — the model never sees any of it.
 */
export function useTableRows(tableId: string, query: TableQueryState): UseTableRows {
  const workItemVisible = useWorkItemVisible()
  const [rows, setRows] = useState<TableRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null)

  const sortColumnId = query.sort?.columnId
  const sortDir = query.sort?.dir
  const { q, qcol } = query

  const fetchPage = useCallback(
    (offset: number) =>
      tableApi.getRows(tableId, {
        offset,
        limit: PAGE,
        sort: sortColumnId,
        dir: sortDir,
        q: q || undefined,
        qcol,
      }),
    [tableId, sortColumnId, sortDir, q, qcol],
  )

  // A monotonic token (bumped per query change) discards stale responses. The
  // count mirror lets the stable `loadMore` guard without a render-time read.
  // Both refs are only ever touched inside effects/callbacks — never in render.
  const tokenRef = useRef(0)
  const liveRef = useRef({ len: rows.length, total, loading })
  useEffect(() => {
    liveRef.current = { len: rows.length, total, loading }
  }, [rows.length, total, loading])

  // Reset + load page 0 on table/query change. Every setState is in an async
  // callback (never synchronously in the effect body) to avoid cascading renders.
  useEffect(() => {
    if (!workItemVisible) return
    tokenRef.current += 1
    const token = tokenRef.current
    let alive = true
    fetchPage(0)
      .then((res) => {
        if (!alive || token !== tokenRef.current) return
        setRows(res.rows)
        setTotal(res.total)
        setError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!alive || token !== tokenRef.current) return
        acknowledgeInline(e)
        setError(documentFailure(e, 'This table could not be read.'))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [fetchPage, workItemVisible])

  const loadMore = useCallback(() => {
    if (!workItemVisible) return
    const { len, total: t, loading: busy } = liveRef.current
    if (busy || len >= t) return
    const token = tokenRef.current
    setLoading(true)
    liveRef.current = { ...liveRef.current, loading: true } // guard re-entry before the sync effect runs
    fetchPage(len)
      .then((res) => {
        if (token !== tokenRef.current) return // a query change superseded this page
        setRows((prev) => [...prev, ...res.rows])
        setTotal(res.total)
        setLoading(false)
      })
      .catch(() => {
        if (token === tokenRef.current) setLoading(false)
      })
  }, [fetchPage, workItemVisible])

  return { rows, total, loading, error, loadMore }
}
