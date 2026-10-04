import { useState } from 'react'
import { Minus, Plus, Settings2 } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { Input } from '@localixai/kit/input'
import {
  indicatorId,
  indicatorKindLabel,
  indicatorParamFields,
  parseIndicatorId,
  validIndicatorParams,
  withIndicatorParam,
} from '../../backend/indicator-spec'
import type { IndicatorSpec } from '../model/indicators'
import { PALETTE } from '../model/indicatorSpecs'
import type { IndicatorPrefRecord, IndicatorRange } from '../model/indicatorPrefs'

/**
 * One indicator's whole settings surface — parameters, colour and (for pane indicators) scale — in
 * a single popover opened from a gear in the legend row's hover cluster. It replaced two colliding
 * surfaces: a colour-only swatch popover and a click-spawned action popover that clamped into the
 * top-left corner, landing on top of the inline parameter fields. Anchored to the row, it flips and
 * shifts instead of clamping, so it never covers what it edits.
 *
 * The parameters are ALSO editable inline in the row ({@link IndicatorParamsInline}) for a one-digit
 * change; this popover is the discoverable, labelled path and the home of colour and scale.
 *
 * Parameters commit on CLOSE, not per keystroke: a committed edit rekeys the indicator, which
 * remounts the legend row and would tear this popover down mid-interaction. Holding the drafts until
 * the popover closes lets the +/- steppers be clicked repeatedly with the sheet open; colour and
 * scale patch live because they never rekey.
 */
export function IndicatorSettingsPopover({
  spec,
  record,
  onPatch,
  onRekey,
}: {
  spec: IndicatorSpec
  record: IndicatorPrefRecord | undefined
  onPatch: (patch: {
    color?: string | null
    range?: IndicatorRange | null
    rangeAuto?: boolean
  }) => void
  /** A committed parameter edit — the id changed; the caller rekeys the record so overrides survive. */
  onRekey: (toId: string) => void
}) {
  const params = parseIndicatorId(spec.id)
  const fields = params ? indicatorParamFields(params) : []
  // Drafts are strings: `2` on the way to `20` is a legitimate hold, and a number cannot represent a
  // half-typed one. Seeded once — a rekey remounts this component (the legend keys rows by id).
  const [texts, setTexts] = useState<string[]>(() => fields.map((f) => String(f.value)))
  const reset = () => setTexts(fields.map((f) => String(f.value)))

  const effectiveRange = record?.rangeAuto ? null : (record?.range ?? spec.defaultRange ?? null)
  const [rangeDraft, setRangeDraft] = useState<{ min: string; max: string }>({
    min: effectiveRange ? String(effectiveRange.min) : '',
    max: effectiveRange ? String(effectiveRange.max) : '',
  })
  const primaryColor =
    record?.color ?? spec.series.find((s) => s.type === 'line')?.color ?? spec.series[0]!.color

  /** Keep the drafts (a half-typed number is a valid edit state) and commit only a valid pair. */
  const applyRange = (min: string, max: string) => {
    setRangeDraft({ min, max })
    const lo = Number(min)
    const hi = Number(max)
    if (min !== '' && max !== '' && Number.isFinite(lo) && Number.isFinite(hi) && lo < hi)
      onPatch({ range: { min: lo, max: hi } })
  }

  const setText = (index: number, value: string) =>
    setTexts((prev) => prev.map((t, i) => (i === index ? value : t)))

  const step = (index: number, delta: number) =>
    setTexts((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t
        const current = Number(t)
        const base = Number.isFinite(current) ? current : (fields[i]?.value ?? 0)
        // Trim binary-float noise (2.1 - 1 = 1.0999…) without forcing integers on fractional params.
        return String(Number((base + delta).toFixed(4)))
      }),
    )

  /** Rebuild the id from the drafts; snap back on anything the grammar rejects, else rekey. */
  const commitParams = () => {
    if (!params) return
    let next = params
    for (const [index, text] of texts.entries()) {
      const value = Number(text)
      if (text.trim() === '' || !Number.isFinite(value)) return reset()
      next = withIndicatorParam(next, index, value)
    }
    if (!validIndicatorParams(next)) return reset()
    const id = indicatorId(next)
    if (id !== spec.id) onRekey(id)
    else reset()
  }

  return (
    <Popover
      onOpenChange={(open) => {
        // Commit as the sheet closes: the rekey it may trigger remounts this component, so it must
        // run after the popover is already on its way out, not while it is the open interaction.
        if (!open) commitParams()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${spec.label} — settings`}
          className="rounded-sm p-0.5 text-text-faint outline-none transition-colors hover:text-foreground focus-ring"
        >
          <Settings2 className="size-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-2 p-2 text-xs">
        <div className="text-2xs font-medium text-text-soft">
          {params ? indicatorKindLabel(params.kind) : spec.label}
        </div>
        {fields.length > 0 && (
          <div className="flex flex-col gap-1">
            {fields.map((field, index) => (
              <div key={field.label} className="flex items-center justify-between gap-3">
                <span className="text-text-soft">{field.label}</span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Decrease ${field.label}`}
                    onClick={() => step(index, -1)}
                    className="rounded-sm border border-border-soft p-0.5 text-text-faint outline-none transition-colors hover:text-foreground focus-ring"
                  >
                    <Minus className="size-2.5" aria-hidden />
                  </button>
                  <Input
                    type="text"
                    inputMode="decimal"
                    aria-label={field.label}
                    spellCheck={false}
                    value={texts[index] ?? ''}
                    onChange={(e) => setText(index, e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-14 text-center tabular-nums"
                  />
                  <button
                    type="button"
                    aria-label={`Increase ${field.label}`}
                    onClick={() => step(index, 1)}
                    className="rounded-sm border border-border-soft p-0.5 text-text-faint outline-none transition-colors hover:text-foreground focus-ring"
                  >
                    <Plus className="size-2.5" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 border-t border-border-soft pt-2">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              aria-label={`Colour ${color}`}
              onClick={() => onPatch({ color: color === primaryColor ? null : color })}
              className={cn(
                'size-4 rounded-full border outline-none transition-transform hover:scale-110 focus-ring',
                color === primaryColor ? 'border-foreground' : 'border-transparent',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        {spec.placement === 'pane' && (
          // Auto is a RESET, not a mode: typing a valid pair IS the fixed range (patchIndicatorPref
          // clears `rangeAuto` when one lands), so a "Fixed" button would only restate the fields.
          <div className="flex items-center gap-1.5 border-t border-border-soft pt-2">
            <button
              type="button"
              onClick={() => {
                onPatch({ rangeAuto: true })
                setRangeDraft({ min: '', max: '' })
              }}
              className={cn(
                'shrink-0 rounded-md border border-border-soft px-1.5 py-1 text-2xs outline-none transition-colors focus-ring',
                // 11% veil, not `bg-surface-raised`: raised mixes from a darker ground than the
                // popover, so the selected "Auto" chip read as a black button on frosted glass.
                effectiveRange === null
                  ? 'bg-surface-active text-foreground'
                  : 'text-text-faint hover:bg-surface-hover hover:text-text-soft',
              )}
            >
              Auto
            </button>
            <Input
              type="number"
              step="any"
              placeholder="min"
              aria-label="Range minimum"
              className="w-14 text-right"
              value={rangeDraft.min}
              onChange={(e) => applyRange(e.target.value, rangeDraft.max)}
            />
            <span className="shrink-0 text-text-faint">–</span>
            <Input
              type="number"
              step="any"
              placeholder="max"
              aria-label="Range maximum"
              className="w-14 text-right"
              value={rangeDraft.max}
              onChange={(e) => applyRange(rangeDraft.min, e.target.value)}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
