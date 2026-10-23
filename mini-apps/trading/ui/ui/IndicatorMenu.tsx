import { useMemo, useState } from 'react'
import { Check, Plus, SlidersHorizontal } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@localixai/kit/command'
import type { IndicatorSpec } from '../model/indicators'
import { INDICATORS, indicatorSpecFor } from '../model/indicatorSpecs'
import { chartToggleChip } from './chartToggleChip'
import {
  INDICATOR_CATEGORIES,
  indicatorAliases,
  indicatorCategory,
  parseIndicatorId,
} from '../../backend/indicator-spec'

/**
 * The indicator picker — a searchable list over everything the chart can draw, built on the
 * shared Popover + Command (cmdk) primitives the rest of the app's pickers use.
 *
 * The list is driven by ACTIVE ∪ CATALOG, not the catalog alone. That distinction is the whole
 * point: an indicator added at custom parameters (`ema:200`) is not a catalog entry, and a menu
 * that renders only the catalog leaves it on the chart with no way to take it off. "On the chart"
 * lists what is actually drawn — every row there removes.
 *
 * The search field doubles as the custom-add: it speaks the SAME tolerant grammar the agent's
 * `manage_chart` does (`ema:200`, `EMA 200`, `st 10 3`), so a query that parses to an indicator
 * the catalog lacks offers to add it. One vocabulary, both callers. Once added, the legend row's
 * gear edits the parameters in place.
 */

/** Catalog ids — a query resolving to one of these is already a row, so it needs no add offer. */
const CATALOG_IDS: ReadonlySet<string> = new Set(INDICATORS.map((spec) => spec.id))

const dotColor = (spec: IndicatorSpec): string =>
  spec.series.find((s) => s.type === 'line')?.color ?? spec.series[0]!.color

/** A preset's search words beyond its label/id: its kind aliases AND its family name, so "hull"
 *  finds HMA and "volume" finds every volume indicator. Empty when the id does not parse. */
const searchWords = (id: string): string => {
  const params = parseIndicatorId(id)
  if (!params) return ''
  return [...indicatorAliases(params.kind), indicatorCategory(params.kind)].join(' ')
}

export function IndicatorMenu({
  activeSpecs,
  onToggle,
  onClear,
}: {
  /** Active indicators, already resolved and sorted (overlays first, then panes). */
  activeSpecs: readonly IndicatorSpec[]
  onToggle: (id: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const active = useMemo(() => new Set(activeSpecs.map((s) => s.id)), [activeSpecs])
  // Available presets grouped by family (Trend / Momentum / Volatility / Volume), in the fixed
  // category order — with 27 presets a flat list buries the one a trader is reaching for.
  const availableByCategory = useMemo(() => {
    const groups = new Map<string, IndicatorSpec[]>()
    for (const spec of INDICATORS) {
      if (active.has(spec.id)) continue
      const params = parseIndicatorId(spec.id)
      if (!params) continue
      const key = indicatorCategory(params.kind)
      const bucket = groups.get(key) ?? []
      bucket.push(spec)
      groups.set(key, bucket)
    }
    return groups
  }, [active])

  // A typed spec the list cannot already offer: parses, is drawable, is neither on the chart
  // nor in the catalog. `volume` is excluded upstream (it is the price pane's own histogram).
  const custom = useMemo(() => {
    const params = query.trim() ? parseIndicatorId(query) : null
    if (!params || params.kind === 'volume') return null
    const spec = indicatorSpecFor(params)
    if (!spec || active.has(spec.id) || CATALOG_IDS.has(spec.id)) return null
    return spec
  }, [query, active])

  const addCustom = () => {
    if (!custom) return
    onToggle(custom.id)
    setQuery('')
  }

  const row = (spec: IndicatorSpec, checked: boolean) => (
    <CommandItem
      key={spec.id}
      // cmdk filters on `value`; label + id + aliases + family make "stochastic", "stoch:14:3:3",
      // "hull" (→ HMA), "kc" (→ Keltner), "force" (→ EFI) and "volume" (→ every volume line) match.
      value={`${spec.label} ${spec.id} ${searchWords(spec.id)}`}
      onSelect={() => onToggle(spec.id)}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor(spec) }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{spec.label}</span>
      {checked ? (
        <Check className="size-3 shrink-0 text-text-soft" />
      ) : (
        <span className="shrink-0 font-mono text-2xs text-text-faint">{spec.id}</span>
      )}
    </CommandItem>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Indicators"
          aria-expanded={open}
          className={cn(
            'flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs outline-none transition-colors focus-ring',
            chartToggleChip(activeSpecs.length > 0),
          )}
        >
          <SlidersHorizontal className="size-3" />
          Indicators
          {activeSpecs.length > 0 && (
            <span className="tabular-nums text-text-soft">· {activeSpecs.length}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <Command
          // The picker composes a set: selecting a row toggles and the list stays put.
          label="Indicators"
          loop
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search, or type ema:200"
          />
          <CommandList className="max-h-80">
            {/* Suppressed while an add is on offer — "no results" next to a result reads as a bug. */}
            {!custom && (
              <CommandEmpty>No indicator matches. Try ema:200 or stoch:14:3:3.</CommandEmpty>
            )}
            {custom && (
              <CommandGroup forceMount heading="Add">
                <CommandItem forceMount value="__custom__" onSelect={addCustom}>
                  <Plus className="size-3 shrink-0 text-text-soft" />
                  <span className="min-w-0 flex-1 truncate">{custom.label}</span>
                  <span className="shrink-0 font-mono text-2xs text-text-faint">{custom.id}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {activeSpecs.length > 0 && (
              <CommandGroup heading={`On the chart · ${activeSpecs.length}`}>
                {activeSpecs.map((spec) => row(spec, true))}
              </CommandGroup>
            )}
            {INDICATOR_CATEGORIES.map(({ key, label }) => {
              const specs = availableByCategory.get(key)
              return specs && specs.length > 0 ? (
                <CommandGroup key={key} heading={label}>
                  {specs.map((spec) => row(spec, false))}
                </CommandGroup>
              ) : null
            })}
          </CommandList>
        </Command>
        {activeSpecs.length > 0 && (
          <div className="border-t border-border-soft p-1">
            <button
              type="button"
              onClick={() => {
                onClear()
                setQuery('')
              }}
              className="w-full rounded-md px-2 py-1 text-left text-2xs text-text-faint outline-none transition-colors hover:bg-surface-hover hover:text-status-error focus-ring"
            >
              Remove all indicators
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
