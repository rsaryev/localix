import type { ReactNode, RefObject } from 'react'
import { Clock, Eraser, Gauge, Ruler, Sparkles } from 'lucide-react'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { ChartDrawing } from '../../backend/chart-drawing'
import { isDetectDrawingId } from '../model/chartDrawings'
import type { ChartType } from '../model/chartType'
import type { IndicatorSpec } from '../model/indicators'
import { openTradingTechnicalsTab } from '../model/openTab'
import { ChartAnalysisMenu, type AnalysisMarket } from './ChartAnalysisMenu'
import { ChartTypeMenu } from './ChartTypeMenu'
import { chartToggleChip } from './chartToggleChip'
import { IndicatorMenu } from './IndicatorMenu'

export function ChartCanvasControls({
  controlsRef,
  rightAxisWidth,
  chartWidth,
  chartType,
  activeSpecs,
  analysisMarket,
  sessionHighlight,
  measuring,
  drawings,
  selectedDrawingId,
  onChartType,
  onToggleIndicator,
  onClearIndicators,
  onApplyIndicators,
  onSessionHighlight,
  onMeasuring,
  onClearAnalysis,
  onClearAll,
}: {
  controlsRef: RefObject<HTMLDivElement | null>
  rightAxisWidth: number
  chartWidth: number
  chartType: ChartType
  activeSpecs: IndicatorSpec[]
  analysisMarket?: AnalysisMarket
  sessionHighlight: boolean
  measuring: boolean
  drawings: ChartDrawing[]
  selectedDrawingId: string | null
  onChartType: (type: ChartType) => void
  onToggleIndicator: (id: string) => void
  onClearIndicators: () => void
  onApplyIndicators: (ids: readonly string[]) => void
  onSessionHighlight: () => void
  onMeasuring: () => void
  onClearAnalysis: (clearSelection: boolean) => void
  onClearAll: () => void
}) {
  const hasAnalysis = drawings.some((drawing) => isDetectDrawingId(drawing.id))
  return (
    <div
      ref={controlsRef}
      className="absolute top-2 z-(--z-raised) flex flex-wrap items-center justify-end gap-1.5"
      style={{
        right: rightAxisWidth + 8,
        maxWidth: Math.max(0, chartWidth - rightAxisWidth - 16),
      }}
    >
      <ChartTypeMenu chartType={chartType} onChartType={onChartType} />
      <IndicatorMenu
        activeSpecs={activeSpecs}
        onToggle={onToggleIndicator}
        onClear={onClearIndicators}
      />
      {analysisMarket && (
        <ChartAnalysisMenu
          market={analysisMarket}
          activeIndicators={activeSpecs.map((spec) => spec.id)}
          onApplyIndicators={onApplyIndicators}
        />
      )}
      {analysisMarket && (
        <button
          type="button"
          title="Open the technical-rating page (oscillators, moving averages, gauges)"
          aria-label="Open technicals"
          onClick={() =>
            openTradingTechnicalsTab({
              connectionId: analysisMarket.connectionId,
              symbol: analysisMarket.symbol,
            })
          }
          className="flex items-center rounded-sm border border-border-soft bg-surface-raised/70 px-1.5 py-0.5 text-2xs text-text-faint outline-none transition-colors hover:text-text-soft focus-ring"
        >
          <Gauge className="size-3" />
        </button>
      )}
      <ToggleControl
        active={sessionHighlight}
        activeTitle="Hide trading sessions"
        inactiveTitle="Highlight trading sessions"
        label="Highlight trading sessions"
        onClick={onSessionHighlight}
      >
        <Clock className="size-3" />
      </ToggleControl>
      <ToggleControl
        active={measuring}
        activeTitle="Exit measure tool"
        inactiveTitle="Measure a move (price, %, bars)"
        label="Measure tool"
        onClick={onMeasuring}
      >
        <Ruler className="size-3" />
      </ToggleControl>
      {hasAnalysis && (
        <button
          type="button"
          title="Clear the agent's analysis overlays (keep your drawings)"
          aria-label="Clear analysis overlays"
          onClick={() =>
            onClearAnalysis(selectedDrawingId !== null && isDetectDrawingId(selectedDrawingId))
          }
          className="flex items-center rounded-sm border border-border-soft bg-surface-raised/70 px-1.5 py-0.5 text-2xs text-text-faint outline-none transition-colors hover:border-control-border-focus/50 hover:text-text-soft focus-ring"
        >
          <Sparkles className="size-3" />
        </button>
      )}
      {(activeSpecs.length > 0 || drawings.length > 0) && (
        <button
          type="button"
          title="Clear all indicators & drawings"
          aria-label="Clear all indicators and drawings"
          onClick={onClearAll}
          className="flex items-center rounded-sm border border-border-soft bg-surface-raised/70 px-1.5 py-0.5 text-2xs text-text-faint outline-none transition-colors hover:border-status-error/40 hover:text-status-error focus-ring"
        >
          <Eraser className="size-3" />
        </button>
      )}
    </div>
  )
}

function ToggleControl({
  active,
  activeTitle,
  inactiveTitle,
  label,
  onClick,
  children,
}: {
  active: boolean
  activeTitle: string
  inactiveTitle: string
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={active ? activeTitle : inactiveTitle}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-center rounded-sm border px-1.5 py-0.5 text-2xs outline-none transition-colors focus-ring',
        chartToggleChip(active),
      )}
    >
      {children}
    </button>
  )
}
