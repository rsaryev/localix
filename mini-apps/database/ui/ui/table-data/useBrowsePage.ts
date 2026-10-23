/**
 * The Data view's read: one page of an object's rows under a sort, plus the client filter over it.
 *
 * The defect this owns: the browse effect listed the tab's VISIBILITY among its dependencies, so
 * every switch back to a table tab — nothing about the read having changed — re-sent the same
 * query and flashed the loading overlay. A parked tab must not fetch (that half was right), but a
 * re-shown tab only fetches when what it would ask for differs from what it last received. The
 * key is recorded when a read SETTLES, not when it starts: a read cancelled by hiding the tab
 * mid-flight never landed, so the next show has to send it again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filterRows, type SortSpec } from '@localixai/dataview'
import { acknowledgeInline, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { resourceKeyAffected } from '@localixai/mini-app-sdk/ui/resource-topics'
import { databaseApi, DbApiError } from '../../api/databaseApi'
import type { DbConnectionInfo } from '../../dbClient'
import { adaptResult, type AdaptedResult } from '../../model/resultAdapter'
import { DATABASE_DATA } from '../../model/topics'
import { useTableViewContext } from '../../model/useTableViewContext'
import { withLiveConnection } from '../../model/withLiveConnection'
import type { DatabaseObjectTarget } from './target'

export const PAGE_SIZE = 100

export interface BrowseError {
  message: string
  code: DbApiError['code']
  /** The driver's own words; the message is the backend's classification of them. */
  detail: string | null
}

export function useBrowsePage({
  connection,
  target,
  visible,
  publishMessageContext,
}: {
  connection: DbConnectionInfo
  target: DatabaseObjectTarget
  /** The hosting work item is on screen; a parked tab does not read. */
  visible: boolean
  publishMessageContext?: PublishMessageContext
}) {
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<AdaptedResult | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<BrowseError | null>(null)
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<SortSpec | undefined>()
  // Stable: the row-edit target memoizes on it as its commit callback.
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  // Rows this page shows moved elsewhere — an agent INSERT, the console's UPDATE. A new revision
  // is a new fetch key: read now when visible, when shown otherwise.
  useEffect(
    () =>
      DATABASE_DATA.subscribe((changed) => {
        if (resourceKeyAffected(connection.id, changed)) refresh()
      }),
    [connection.id, refresh],
  )
  const sortColumn =
    sort && result
      ? result.columns.find((candidate) => candidate.id === sort.columnId)?.title
      : undefined
  const sortDirection = sortColumn ? sort?.dir : undefined

  // A different object starts on its first page, unfiltered and unsorted.
  useEffect(() => {
    setPage(0)
    setFilter('')
    setSort(undefined)
  }, [connection.id, target.table, target.schema])

  const fetchKey = JSON.stringify([
    connection.id,
    target.schema ?? '',
    target.table,
    page,
    revision,
    sortColumn ?? '',
    sortDirection ?? '',
  ])
  const settledKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!visible || settledKeyRef.current === fetchKey) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const request = {
      table: target.table,
      schema: target.schema,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sort:
        sortColumn && sortDirection ? { column: sortColumn, direction: sortDirection } : undefined,
    }
    void withLiveConnection(connection.id, () => databaseApi.browse(connection.id, request))
      .then((next) => {
        if (cancelled) return
        setResult(adaptResult(next))
        setDurationMs(next.durationMs)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setResult(null)
        acknowledgeInline(cause)
        setError({
          message: cause instanceof Error ? cause.message : 'Could not browse this object.',
          code: cause instanceof DbApiError ? cause.code : undefined,
          detail: cause instanceof DbApiError ? (cause.detail ?? null) : null,
        })
      })
      .finally(() => {
        if (cancelled) return
        settledKeyRef.current = fetchKey
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `fetchKey` encodes every read input below; listing them again would only restate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, visible])

  const visibleRows = useMemo(
    () => (result ? filterRows(result.rows, { query: filter }) : []),
    [result, filter],
  )

  const toggleSort = (columnId: string) => {
    setPage(0)
    setSort((current) =>
      current?.columnId === columnId
        ? current.dir === 'asc'
          ? { columnId, dir: 'desc' }
          : undefined
        : { columnId, dir: 'asc' },
    )
  }

  const qualifiedName = target.schema ? `${target.schema}.${target.table}` : target.table
  useTableViewContext({
    publishMessageContext,
    table: qualifiedName,
    connection: connection.name,
    columns: result?.columns,
    rows: visibleRows,
    page,
    pageSize: PAGE_SIZE,
    filter,
    error: error?.message ?? null,
  })

  // The grid's staged mutation ledger is keyed by row object identity. Page/sort/refresh
  // changes replace that identity domain, so the grid remounts on this key before the next
  // result, keeping page A's edits from being submitted through page B's result metadata.
  const dataScopeKey = JSON.stringify([
    connection.id,
    target.schema ?? '',
    target.table,
    page,
    revision,
    sort?.columnId ?? '',
    sort?.dir ?? '',
  ])

  return {
    page,
    setPage,
    refresh,
    result,
    durationMs,
    loading,
    error,
    filter,
    setFilter,
    sort,
    toggleSort,
    visibleRows,
    qualifiedName,
    dataScopeKey,
    hasNext: (result?.rows.length ?? 0) === PAGE_SIZE,
  }
}

export type BrowsePage = ReturnType<typeof useBrowsePage>
