import { ChartArea, ChartColumn, ChartLine, ChartPie, ChartScatter } from 'lucide-react'
import { isNumericType, CHART_KINDS, type ChartKind, type TableColumn } from '@localixai/dataview'
import type { IconComponent, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { PickMenu } from '../PickMenu'
import type { useChartState } from './useChartState'

/**
 * HOW THE RESULT IS CHARTED — one quiet "Chart" menu, a submenu per dimension.
 *
 * It was three framed `Select` fields in the result toolbar (kind, X column, Y column): form
 * fields in a header, each out-shouting the grid it configures, and each spelling its dimension
 * into every option (`X: name`) because a field has nowhere else to say what it picks. A menu row
 * says it once — the submenu's label — and shows the current pick as its `hint`; the options are
 * `selected` rows that keep the menu open, so the new answer is what the person sees next.
 */
const KIND_ICON: Record<ChartKind, IconComponent> = {
  bar: ChartColumn,
  line: ChartLine,
  area: ChartArea,
  pie: ChartPie,
  scatter: ChartScatter,
}

const KIND_LABEL: Record<ChartKind, string> = {
  bar: 'Bar',
  line: 'Line',
  area: 'Area',
  pie: 'Pie',
  scatter: 'Scatter',
}

/** `''` is "auto" — the chart's own default column, also what a stale override falls back to. */
function axisEntries(
  axis: 'x' | 'y',
  columns: readonly TableColumn[],
  current: string,
  pick: (id: string) => void,
): MenuEntry[] {
  return [
    {
      id: `${axis}:auto`,
      label: 'Auto',
      selected: current === '',
      keepOpen: true,
      onSelect: () => pick(''),
    },
    { separator: true },
    ...columns.map((col) => ({
      id: `${axis}:${col.id}`,
      label: col.title,
      selected: current === col.id,
      keepOpen: true,
      onSelect: () => pick(col.id),
    })),
  ]
}

export function ChartMenu({
  columns,
  chart,
}: {
  columns: TableColumn[]
  chart: ReturnType<typeof useChartState>
}) {
  const numericCols = columns.filter((col) => isNumericType(col.type))
  // An override that no longer names a column of this result is ignored by the spec, so the
  // menu shows it as what it is: auto.
  const xCol = columns.some((c) => c.id === chart.xCol) ? chart.xCol : ''
  const yCol = numericCols.some((c) => c.id === chart.yCol) ? chart.yCol : ''
  const titleOf = (cols: readonly TableColumn[], id: string) =>
    cols.find((c) => c.id === id)?.title ?? 'Auto'
  const entries: MenuEntry[] = [
    {
      id: 'kind',
      label: 'Type',
      icon: KIND_ICON[chart.chartKind],
      hint: KIND_LABEL[chart.chartKind],
      items: CHART_KINDS.map((kind) => ({
        id: `kind:${kind}`,
        label: KIND_LABEL[kind],
        icon: KIND_ICON[kind],
        selected: chart.chartKind === kind,
        keepOpen: true,
        onSelect: () => chart.setChartKind(kind),
      })),
    },
    {
      id: 'x',
      label: 'X axis',
      hint: titleOf(columns, xCol),
      items: axisEntries('x', columns, xCol, chart.setXCol),
    },
    {
      id: 'y',
      label: 'Y axis',
      hint: titleOf(numericCols, yCol),
      items: axisEntries('y', numericCols, yCol, chart.setYCol),
    },
  ]
  return <PickMenu label="Chart" aria-label="Chart settings" entries={entries} />
}
