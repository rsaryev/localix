import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  snippetMessageBindingDraft,
  toast,
  type PublishMessageContext,
} from '@localixai/mini-app-sdk/ui'
import {
  createDefaultExporterRegistry,
  defaultChartSpec,
  isChartKind,
  type ChartSpec,
  type SortSpec,
  type ViewKind,
} from '@localixai/dataview'
import { tableApi } from '../api/tableApi'
import type { OpenTargetView, TableMeta } from '../docClient'
import { useTableRows } from './useTableRows'
import { useDocumentProblem } from '../problems'
import { TableGrid } from '@localixai/mini-app-sdk/ui/components'
import { TableToolbar, type ExporterChoice } from './TableToolbar'
import { ChartView } from '@localixai/mini-app-sdk/ui/charts'
import { downloadChartPng, downloadChartSvg } from '@localixai/mini-app-sdk/ui/chart-export'
import { downloadTable } from './download'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { useDebounced } from '@localixai/mini-app-sdk/ui/runtime-hooks'

/** Pull more rows for charts up to this cap — charts plot a representative
 * sample without eagerly loading a 100k-row table. The grid stays fully lazy. */
const CHART_SAMPLE_CAP = 4000

/**
 * Inspector Table tab: a native, file-backed data view. Rows stream lazily from
 * `/rpc/table/:id/rows` (server sort/filter/paging), so the model never sees the
 * data — only metadata is loaded eagerly. Switches between a
 * virtualized grid and dependency-free SVG charts over the same dataset.
 */
export function TableTab({
  tableId,
  title,
  publishMessageContext,
}: {
  tableId: string
  title?: string
  publishMessageContext?: PublishMessageContext
}) {
  const workItemVisible = useWorkItemVisible()
  const [meta, setMeta] = useState<TableMeta>()
  const [view, setView] = useState<ViewKind>('table')
  const [chartSpec, setChartSpec] = useState<ChartSpec>()
  const [sort, setSort] = useState<SortSpec | undefined>(undefined)
  const [filterText, setFilterText] = useState('')
  const [openTargets, setOpenTargets] = useState<OpenTargetView[]>([])
  const q = useDebounced(filterText, 250)
  const chartRef = useRef<HTMLDivElement>(null)
  // Seeded tab already has authoritative view/chart; a restored tab adopts them
  // from the fetched meta exactly once (without clobbering later user choices).
  const initialized = useRef(false)

  const { rows, total, loading, error, loadMore } = useTableRows(tableId, { sort, q })

  useEffect(() => {
    if (!workItemVisible) return
    let alive = true
    tableApi
      .getMeta(tableId)
      .then((m) => {
        if (!alive) return
        setMeta(m)
        if (!initialized.current) {
          initialized.current = true
          setView(m.view)
          setChartSpec(m.chart)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [tableId, workItemVisible])

  useEffect(() => {
    if (!workItemVisible) return
    let alive = true
    tableApi
      .openTargets()
      .then((r) => {
        if (alive) setOpenTargets(r.targets)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [workItemVisible])

  // Top up the loaded sample when a chart view is active (bounded, lazy).
  useEffect(() => {
    if (!workItemVisible) return
    if (view !== 'table' && rows.length < Math.min(total, CHART_SAMPLE_CAP)) loadMore()
  }, [view, rows.length, total, loadMore, workItemVisible])

  const columns = useMemo(() => meta?.columns ?? [], [meta])
  const name = meta?.title ?? title
  const problem = useDocumentProblem({
    label: name ?? 'Table',
    message: error?.message,
    detail: error?.detail,
  })

  // Agent-produced tables do not have a filesystem/provider URI. Publish a
  // bounded snapshot of the CURRENT filtered/sorted view instead: enough schema
  // and sample rows to ground a question, never the whole lazy dataset.
  useEffect(() => {
    if (!publishMessageContext) return
    if (!meta) {
      publishMessageContext(null)
      return
    }
    const snapshot = JSON.stringify(
      {
        tableId,
        title: name ?? 'Table',
        view,
        totalRows: total,
        filter: q || undefined,
        sort,
        columns: columns.map((column) => ({
          id: column.id,
          title: column.title,
          type: column.type,
        })),
        sampleRows: rows.slice(0, 20),
      },
      null,
      2,
    )
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        snippetMessageBindingDraft({
          label: name ?? 'Table',
          content:
            snapshot.length > 40_000
              ? `${snapshot.slice(0, 40_000)}\n… [table snapshot truncated]`
              : snapshot,
          language: 'json',
        }),
      ],
    })
  }, [columns, meta, name, publishMessageContext, q, rows, sort, tableId, total, view])

  const effectiveChart = useMemo<ChartSpec | undefined>(() => {
    if (view === 'table' || columns.length === 0 || !isChartKind(view)) return undefined
    if (chartSpec?.kind === view) return chartSpec
    return defaultChartSpec(view, columns)
  }, [view, chartSpec, columns])

  const exporters = useMemo<ExporterChoice[]>(
    () =>
      createDefaultExporterRegistry()
        .list()
        .map((e) => ({ id: e.id, label: e.label, extension: e.extension })),
    [],
  )

  const onToggleSort = useCallback((columnId: string) => {
    setSort((cur) => {
      if (cur?.columnId !== columnId) return { columnId, dir: 'asc' }
      if (cur.dir === 'asc') return { columnId, dir: 'desc' }
      return undefined // third click clears the sort
    })
  }, [])

  const onExportTable = useCallback(
    (formatId: string) => {
      const ext = exporters.find((e) => e.id === formatId)?.extension ?? formatId
      // A failed download used to be an unhandled rejection: the menu closed and nothing arrived.
      downloadTable(tableId, formatId, ext, name).catch((e: unknown) =>
        toast.error(`Could not export “${name}”`, {
          description: errorMessage(e, '') || undefined,
        }),
      )
    },
    [exporters, tableId, name],
  )

  const onExportChart = useCallback(
    async (fmt: 'svg' | 'png') => {
      const svg = chartRef.current?.querySelector('svg')
      // Not a failure: the chart simply has not drawn yet (or has nothing to draw). The export
      // menu has closed, so the answer takes the host's transient line, not a journal row.
      if (!svg) {
        toast.info('Nothing to export', { description: 'The chart has not drawn anything yet.' })
        return
      }
      try {
        if (fmt === 'svg') downloadChartSvg(svg as SVGSVGElement, name)
        else await downloadChartPng(svg as SVGSVGElement, name)
      } catch (e) {
        // `errorMessage(e, fallback)` drops the fallback the moment the throw has any message of
        // its own, so a canvas failure read as a bare DOM string. The sentence stays; the raw text
        // goes where there is room for it.
        toast.error('Could not export the chart', {
          description: errorMessage(e, '') || undefined,
        })
      }
    },
    [name],
  )

  // The native app opening is the confirmation, so only a refusal or a throw posts a row.
  const openFailure = useCallback(
    (targetId: string) => {
      const target = openTargets.find((t) => t.id === targetId)?.label
      return target ? `Could not open “${name}” in ${target}` : `Could not open “${name}”`
    },
    [openTargets, name],
  )

  const onOpen = useCallback(
    async (targetId: string) => {
      const res = await tableApi.open(tableId, targetId)
      if (res.error) toast.error(openFailure(targetId), { description: res.error })
    },
    [tableId, openFailure],
  )

  return (
    <div className="flex h-full flex-col">
      <TableToolbar
        view={view}
        onViewChange={setView}
        filter={filterText}
        onFilterChange={setFilterText}
        exporters={exporters}
        onExportTable={onExportTable}
        onExportChart={(fmt) => {
          void onExportChart(fmt)
        }}
        openTargets={openTargets}
        onOpen={(targetId) => {
          onOpen(targetId).catch((e) =>
            toast.error(openFailure(targetId), {
              description: errorMessage(e, '') || undefined,
            }),
          )
        }}
      />

      <div className="relative min-h-0 flex-1">
        {error ? (
          problem
        ) : view === 'table' ? (
          <TableGrid
            columns={columns}
            rows={rows}
            total={total}
            sort={sort}
            onToggleSort={onToggleSort}
            onReachEnd={loadMore}
          />
        ) : (
          <div ref={chartRef} className="h-full w-full">
            {effectiveChart && <ChartView columns={columns} rows={rows} spec={effectiveChart} />}
          </div>
        )}

        {loading && rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingHint className="text-xs" />
          </div>
        )}
      </div>
    </div>
  )
}
