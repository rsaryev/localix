import { useState } from 'react'
import {
  indicatorId,
  indicatorKindLabel,
  indicatorParamFields,
  parseIndicatorId,
  validIndicatorParams,
  withIndicatorParam,
} from '../../backend/indicator-spec'
import type { IndicatorSpec } from '../model/indicators'
import { cn, CONTROL_FOCUS_VISIBLE } from '@localixai/mini-app-sdk/ui/classes'

/**
 * An indicator's parameters, edited where they are read: the legend row itself. `EMA 20` is the
 * name plus one number, so the number is a field — not a line in a settings sheet reached through
 * a gear, a popover and an Apply button, which is three acts of navigation to change one digit.
 *
 * Every kind renders the same way: the name, then one field per parameter in canonical id order
 * (`MACD 12 26 9`). At rest a field is indistinguishable from the label; the row's hover tints it
 * and a click puts a caret in it.
 *
 * Commit is on Enter or blur, never per keystroke — a rekey rebuilds the series, and typing `200`
 * over `20` passes through `2` and `20` on the way. An edit that does not parse, does not validate,
 * or collides with an indicator already on the chart snaps back: the chart never holds a state the
 * grammar would reject.
 */

/** One parameter, sized to its own digits so the row never jumps as the number grows. */
function ParamField({
  label,
  text,
  onText,
  onCommit,
  onCancel,
}: {
  label: string
  text: string
  onText: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      title={label}
      value={text}
      spellCheck={false}
      onChange={(e) => onText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        // The chart owns most keys; while a caret is here they are the field's.
        e.stopPropagation()
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          onCancel()
          e.currentTarget.blur()
        }
      }}
      onBlur={onCommit}
      // `ch` on a tabular-nums face is exactly one digit wide, so the field fits its content.
      style={{ width: `${Math.max(text.length, 1)}ch` }}
      className={cn(
        'rounded-sm border border-transparent bg-transparent text-center tabular-nums transition-colors group-hover:bg-surface-hover/80 group-hover:text-foreground focus:bg-surface-hover focus:text-foreground',
        CONTROL_FOCUS_VISIBLE,
      )}
    />
  )
}

export function IndicatorParamsInline({
  spec,
  onRekey,
}: {
  spec: IndicatorSpec
  /** A committed edit — the id changed; the caller rekeys the record so overrides survive. */
  onRekey: (toId: string) => void
}) {
  const params = parseIndicatorId(spec.id)
  const fields = params ? indicatorParamFields(params) : []
  // Drafts are strings: `2` on the way to `20` is a legitimate thing to be holding, and a number
  // cannot represent a half-typed one. Seeded once — a commit rekeys, which remounts the row.
  const [texts, setTexts] = useState<string[]>(() => fields.map((f) => String(f.value)))

  if (!params) return <span className="text-text-soft">{spec.label}</span>
  if (fields.length === 0) return <span className="text-text-soft">{spec.label}</span>

  const reset = () => setTexts(fields.map((f) => String(f.value)))

  const commit = () => {
    let next = params
    for (const [index, text] of texts.entries()) {
      const value = Number(text)
      if (text.trim() === '' || !Number.isFinite(value)) return reset()
      next = withIndicatorParam(next, index, value)
    }
    if (!validIndicatorParams(next)) return reset()
    const id = indicatorId(next)
    if (id !== spec.id) onRekey(id)
    // A rekey remounts this row (the legend keys by id); a no-op edit leaves the drafts as typed,
    // so normalize them back to the parsed numbers — `020` must not linger as the label.
    else reset()
  }

  return (
    <span className="flex items-center gap-1 text-text-soft">
      <span>{indicatorKindLabel(params.kind)}</span>
      {fields.map((field, index) => (
        <ParamField
          key={field.label}
          label={field.label}
          text={texts[index] ?? ''}
          onText={(value) => setTexts((prev) => prev.map((t, i) => (i === index ? value : t)))}
          onCommit={commit}
          onCancel={reset}
        />
      ))}
    </span>
  )
}
