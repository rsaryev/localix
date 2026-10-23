import { BarChart3, CandlestickChart, LineChart, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { CHART_TYPES, type ChartType } from '../model/chartType'
import { chartToggleChip } from './chartToggleChip'

/**
 * The chart-type picker — how price is DRAWN (candles / line / area / bars). A menu, not a cycle
 * button: four states cycled blind is three wrong charts on the way to the right one. Sits beside
 * the indicator menu in the canvas' top-right control cluster and mirrors its visual language.
 *
 * Its rows are the app's `selected` menu rows. They were Radix radio items with the type's icon
 * placed inline after the radio dot, so the dot and the icon both took leading space and the
 * labels sat a column further right than every other menu's; a `selected` row keeps the icon in
 * the leading slot and marks the chosen type with the menu's own trailing check.
 */

const LABELS: Record<ChartType, string> = {
  candles: 'Candles',
  line: 'Line',
  area: 'Area',
  bars: 'Bars (OHLC)',
}

const ICONS: Record<ChartType, LucideIcon> = {
  candles: CandlestickChart,
  line: LineChart,
  area: TrendingUp,
  bars: BarChart3,
}

export function ChartTypeMenu({
  chartType,
  onChartType,
}: {
  chartType: ChartType
  onChartType: (type: ChartType) => void
}) {
  const Icon = ICONS[chartType]
  const entries: MenuEntry[] = CHART_TYPES.map((type) => ({
    id: type,
    label: LABELS[type],
    icon: ICONS[type],
    selected: type === chartType,
    onSelect: () => {
      if (type !== chartType) onChartType(type)
    },
  }))
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Chart type"
          className={cn(
            'flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs outline-none transition-colors focus-ring',
            chartToggleChip(chartType !== 'candles'),
          )}
        >
          <Icon className="size-3" />
          {LABELS[chartType]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
