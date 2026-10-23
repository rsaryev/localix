import type { ReactNode } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { IndicatorSpec } from '../model/indicators'
import type { IndicatorPrefRecord, IndicatorRange } from '../model/indicatorPrefs'
import { formatCompactVolume } from '../model/formatQuote'
import { IndicatorParamsInline } from './IndicatorParamsInline'
import { IndicatorSettingsPopover } from './IndicatorSettingsPopover'

/**
 * Per-indicator legend rows. A row reads name + parameters + the crosshair
 * values tinted per plot. The parameters are live fields, edited in place; hovering the row tints
 * them and reveals the colour / eye / remove cluster, so the resting state stays a quiet readout
 * rather than a toolbar.
 *
 * Two placements, two positioning laws:
 *
 * - OVERLAY rows share the price pane, so they stack in ONE flow column with the OHLCV readout
 *   (`header`) above them. This component owns that whole column — the readout used to be a
 *   separate absolute layer at `top-2` with the rows guessing `top-7` below it, which overlapped
 *   the moment the readout wrapped to a second line. Normal flow cannot overlap.
 * - PANE rows are pinned to the top edge of their own pane, which only the chart knows; the
 *   caller measures those tops from the live pane elements and each row is absolute at one.
 */

export interface IndicatorLegendEntry {
  spec: IndicatorSpec
  record: IndicatorPrefRecord | undefined
  /** Values at the crosshair (or the latest bar when idle), keyed by series key. */
  values: Record<string, number> | undefined
  /** Top offset (px, container-relative) for a PANE indicator's row; overlays stack. */
  paneTop?: number
}

function formatValue(spec: IndicatorSpec, value: number): string {
  if (spec.valueFormat === 'volume') return formatCompactVolume(value)
  // Indicator values span RSI's 0–100 and a BTC price — 4 significant digits reads both.
  return Math.abs(value) >= 1000 ? value.toFixed(1) : value.toPrecision(4)
}

export function IndicatorLegendRow({
  entry,
  onToggleHidden,
  onRemove,
  onRekey,
  onPatch,
  highlighted,
}: {
  entry: IndicatorLegendEntry
  onToggleHidden: (id: string) => void
  onRemove: (id: string) => void
  onRekey: (fromId: string, toId: string) => void
  onPatch: (
    id: string,
    patch: { color?: string | null; range?: IndicatorRange | null; rangeAuto?: boolean },
  ) => void
  highlighted?: boolean
}) {
  const { spec, record, values } = entry
  const hidden = record?.hidden === true
  const primaryIndex = Math.max(
    spec.series.findIndex((s) => s.type === 'line'),
    0,
  )
  return (
    <div
      className={cn(
        'group relative pointer-events-auto flex w-fit items-center gap-1.5 rounded-sm px-1 py-0.5 text-2xs tabular-nums',
        'bg-background/40 backdrop-blur-[2px] transition-colors hover:bg-surface-raised/80',
        hidden && 'opacity-50',
        highlighted &&
          'bg-surface-raised/95 ring-1 ring-control-border-focus/60 shadow-(--shadow-popover)',
      )}
    >
      <IndicatorParamsInline spec={spec} onRekey={(toId) => onRekey(spec.id, toId)} />
      {!hidden &&
        spec.series.map((s, i) => {
          const value = values?.[s.key]
          if (value === undefined) return null
          const color = i === primaryIndex && record?.color ? record.color : s.color
          return (
            <span key={s.key} style={{ color }}>
              {formatValue(spec, value)}
            </span>
          )
        })}
      {/* Parked OUTSIDE the row's box (`left-full`) rather than inside it: revealing controls in
          flow would widen the row and shove its numbers sideways under the cursor. Absolute, they
          cost the row no width, and they stay descendants — so hovering them keeps `:hover` on the
          row and the group open. Hidden via opacity, NOT display: `display: none` drops the buttons
          from the tab order, and `focus-within` cannot fire on an element that never renders — so
          the cluster stays mounted, invisible, with pointer-events off to kill ghost click targets. */}
      <span
        className={cn(
          'lx-hover-actions absolute left-full top-0 z-(--z-raised) flex h-full items-center gap-0.5 rounded-r-sm border-l border-border-soft bg-surface-raised/95 pl-1 pr-0.5 shadow-(--shadow-popover) transition-opacity',
          highlighted
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
        )}
      >
        <IndicatorSettingsPopover
          spec={spec}
          record={record}
          onPatch={(patch) => onPatch(spec.id, patch)}
          onRekey={(toId) => onRekey(spec.id, toId)}
        />
        <button
          type="button"
          title={hidden ? `Show ${spec.label}` : `Hide ${spec.label}`}
          onClick={() => onToggleHidden(spec.id)}
          className="rounded-sm p-0.5 text-text-faint outline-none transition-colors hover:text-foreground focus-ring"
        >
          {hidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        </button>
        <button
          type="button"
          title={`Remove ${spec.label}`}
          onClick={() => onRemove(spec.id)}
          className="rounded-sm p-0.5 text-text-faint outline-none transition-colors hover:text-status-error focus-ring"
        >
          <X className="size-3" />
        </button>
      </span>
    </div>
  )
}

export function IndicatorLegend({
  entries,
  header,
  rightInset,
  onToggleHidden,
  onRemove,
  onRekey,
  onPatch,
  highlightedId,
}: {
  entries: IndicatorLegendEntry[]
  /** The OHLCV readout — first row of the overlay column, above the overlay indicators. */
  header?: ReactNode
  /** Reserved width (px) on the right — the price axis PLUS the control cluster. The column's
   *  text wraps before this band instead of sliding under the axis or the toolbar. */
  rightInset: number
  onToggleHidden: (id: string) => void
  onRemove: (id: string) => void
  onRekey: (fromId: string, toId: string) => void
  onPatch: (
    id: string,
    patch: { color?: string | null; range?: IndicatorRange | null; rangeAuto?: boolean },
  ) => void
  highlightedId?: string | null
}) {
  const overlays = entries.filter((e) => e.spec.placement === 'overlay')
  const panes = entries.filter((e) => e.spec.placement === 'pane' && e.paneTop !== undefined)
  const rowProps = { onToggleHidden, onRemove, onRekey, onPatch }
  return (
    <>
      {/* One column, normal flow. The max width reserves the band the chart controls occupy — the
          price axis plus the toolbar, measured together as `rightInset` — so the wrapping readout
          stops before them instead of sliding underneath. `items-start` keeps rows shrink-to-fit. */}
      <div
        className="pointer-events-none absolute left-2 top-2 z-(--z-raised) flex max-w-full flex-col items-start gap-px overflow-hidden"
        style={{ maxWidth: `max(0px, calc(100% - ${rightInset}px))` }}
      >
        {header}
        {overlays.map((entry) => (
          <IndicatorLegendRow
            key={entry.spec.id}
            entry={entry}
            highlighted={highlightedId === entry.spec.id}
            {...rowProps}
          />
        ))}
      </div>
      {panes.map((entry) => (
        <div
          key={entry.spec.id}
          className="pointer-events-none absolute left-2 z-(--z-raised)"
          style={{ top: entry.paneTop! + 2 }}
        >
          <IndicatorLegendRow
            entry={entry}
            highlighted={highlightedId === entry.spec.id}
            {...rowProps}
          />
        </div>
      ))}
    </>
  )
}
