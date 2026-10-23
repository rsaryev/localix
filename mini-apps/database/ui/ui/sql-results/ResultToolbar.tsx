import { Table2, BarChart3, Download } from 'lucide-react'
import type { TableColumn } from '@localixai/dataview'
import { SearchInput } from '@localixai/kit/search-input'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { ChartMenu } from './ChartMenu'
import type { useChartState } from './useChartState'

/**
 * Top row above the grid: the client-side filter box plus the grid↔chart controls (the Chart
 * menu + PNG download) when the result is chartable.
 *
 * The shared compact toolbar with every control on the `md` rung. The hand-rolled strip mixed a
 * 28px search box, selects squeezed to 24px, 20px icon buttons and a 24px segmented track, so the
 * row's controls stood on four different baselines.
 */
export function ResultToolbar({
  columns,
  chart,
  showChart,
  canChart,
  filter,
  onFilterChange,
}: {
  columns: TableColumn[]
  chart: ReturnType<typeof useChartState>
  showChart: boolean
  canChart: boolean
  filter?: string
  onFilterChange?: (query: string) => void
}) {
  return (
    <WorkbenchToolbar density="compact" aria-label="Result controls">
      {onFilterChange && (
        <SearchInput
          size="md"
          value={filter ?? ''}
          onValueChange={onFilterChange}
          placeholder="Filter rows…"
          className="w-40"
        />
      )}
      {canChart && (
        <WorkbenchToolbarSection align="end" spacing="compact">
          {showChart && (
            <>
              <ChartMenu columns={columns} chart={chart} />
              <IconButton
                tooltip="Download chart as PNG"
                aria-label="Download chart as PNG"
                onClick={() => void chart.downloadChart()}
              >
                <Download className="size-3.5" />
              </IconButton>
            </>
          )}
          <div role="group" aria-label="Result view" className="flex items-center gap-0.5">
            <IconButton
              tooltip="Table view"
              aria-label="Table view"
              aria-pressed={chart.view === 'grid'}
              onClick={() => chart.setView('grid')}
              className={chart.view === 'grid' ? 'bg-surface-active text-foreground' : undefined}
            >
              <Table2 className="size-3.5" />
            </IconButton>
            <IconButton
              tooltip="Chart view"
              aria-label="Chart view"
              aria-pressed={chart.view === 'chart'}
              onClick={() => chart.setView('chart')}
              className={chart.view === 'chart' ? 'bg-surface-active text-foreground' : undefined}
            >
              <BarChart3 className="size-3.5" />
            </IconButton>
          </div>
        </WorkbenchToolbarSection>
      )}
    </WorkbenchToolbar>
  )
}
