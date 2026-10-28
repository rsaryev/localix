import { useState } from 'react'
import {
  isNumericType,
  defaultChartSpec,
  type ChartKind,
  type TableColumn,
} from '@localixai/dataview'
import { toast } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { downloadChartPng } from '@localixai/mini-app-sdk/ui/chart-export'

/** Grid ↔ chart view state for the current result (chart is read-only; editing stays in
 *  grid), plus axis overrides ('' = auto; ignored when they don't match the columns). */
export function useChartState() {
  const [view, setView] = useState<'grid' | 'chart'>('grid')
  const [chartKind, setChartKind] = useState<ChartKind>('bar')
  const [xCol, setXCol] = useState('')
  const [yCol, setYCol] = useState('')
  // The chart's host element, held as state through a callback ref: the hook's result is read
  // during render, so it must not carry a ref object.
  const [chartEl, setChartEl] = useState<HTMLDivElement | null>(null)
  // Resolves, never rejects: the caller is a button, and a canvas that refuses to encode used to
  // surface as an unhandled rejection — a click that did nothing.
  const downloadChart = async () => {
    const svg = chartEl?.querySelector('svg')
    if (!svg) return
    try {
      await downloadChartPng(svg as SVGSVGElement, 'chart')
    } catch (cause) {
      toast.error('Could not download the chart', {
        description: errorMessage(cause, '') || undefined,
      })
    }
  }
  return {
    view,
    setView,
    chartKind,
    setChartKind,
    xCol,
    setXCol,
    yCol,
    setYCol,
    setChartEl,
    downloadChart,
  }
}

/**
 * Chart spec: auto defaults for the kind, with the user's X/Y overrides applied when
 * they still name a valid column (a new result with different columns falls back to auto).
 */
export function resolveChartSpec(
  chartKind: ChartKind,
  columns: TableColumn[],
  xCol: string,
  yCol: string,
) {
  const numericCols = columns.filter((col) => isNumericType(col.type))
  const def = defaultChartSpec(chartKind, columns)
  return {
    kind: chartKind,
    x: xCol && columns.some((c) => c.id === xCol) ? xCol : def.x,
    y: yCol && numericCols.some((c) => c.id === yCol) ? [yCol] : def.y,
  }
}
