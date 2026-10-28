import {
  AreaChart,
  BarChart3,
  ChevronDown,
  Download,
  ExternalLink,
  LineChart,
  PieChart,
  ScatterChart,
  Table as TableIcon,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ViewKind } from '@localixai/dataview'
import type { OpenTargetView } from '../docClient'
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@localixai/mini-app-sdk/ui/segmented-control'
import { Button } from '@localixai/kit/button'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'

const VIEWS: { kind: ViewKind; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { kind: 'table', label: 'Table', Icon: TableIcon },
  { kind: 'bar', label: 'Bar', Icon: BarChart3 },
  { kind: 'line', label: 'Line', Icon: LineChart },
  { kind: 'area', label: 'Area', Icon: AreaChart },
  { kind: 'pie', label: 'Pie', Icon: PieChart },
  { kind: 'scatter', label: 'Scatter', Icon: ScatterChart },
]

export interface ExporterChoice {
  id: string
  label: string
  extension: string
}

interface TableToolbarProps {
  view: ViewKind
  onViewChange: (view: ViewKind) => void
  filter: string
  onFilterChange: (value: string) => void
  exporters: ExporterChoice[]
  onExportTable: (formatId: string) => void
  /** Chart-only image export, present when a chart view is active. */
  onExportChart?: (format: 'svg' | 'png') => void
  openTargets: OpenTargetView[]
  onOpen: (targetId: string) => void
}

/** Header strip: view switch + filter + export menu + "Open in…" menu. */
export function TableToolbar({
  view,
  onViewChange,
  filter,
  onFilterChange,
  exporters,
  onExportTable,
  onExportChart,
  openTargets,
  onOpen,
}: TableToolbarProps) {
  const isChart = view !== 'table'
  return (
    <WorkbenchToolbar wrap aria-label="Table controls">
      <SegmentedControl variant="muted">
        {VIEWS.map(({ kind, label, Icon }) => (
          <SegmentedControlItem
            key={kind}
            active={view === kind}
            onClick={() => onViewChange(kind)}
            title={label}
            aria-label={`${label} view`}
          >
            <Icon className="size-3.5" />
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      <div className="min-w-32 flex-1">
        <SearchInput
          value={filter}
          onValueChange={onFilterChange}
          placeholder="Filter rows…"
          size="md"
          className="max-w-64"
        />
      </div>

      {/* Export */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="default">
            <Download className="size-3.5" />
            <span>Export</span>
            <ChevronDown className="size-3 text-text-faint" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Data</DropdownMenuLabel>
          {exporters.map((e) => (
            <DropdownMenuItem key={e.id} onSelect={() => onExportTable(e.id)}>
              {e.label}
            </DropdownMenuItem>
          ))}
          {isChart && onExportChart && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Chart</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onExportChart('png')}>PNG image</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onExportChart('svg')}>SVG vector</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Open in native app */}
      {openTargets.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="default">
              <ExternalLink className="size-3.5" />
              <span>Open in</span>
              <ChevronDown className="size-3 text-text-faint" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {openTargets.map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => onOpen(t.id)}>
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </WorkbenchToolbar>
  )
}
