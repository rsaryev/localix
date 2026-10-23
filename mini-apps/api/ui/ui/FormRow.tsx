import type { ReactNode } from 'react'

/**
 * One protocol-form row: a stable label on the left, the editable value on the right.
 *
 * The Settings and Auth tabs sit one tab apart and each wrote this row by hand — a `10rem`
 * `text-xs` label beside an `8.5rem` `SectionLabel`, rules at different steps, and a dead `<span />`
 * spacer pushing Settings' switch to a third column — so the label column jumped when switching
 * tabs. The value column fills the pane: a column cap here stopped these fields short of the URL
 * bar above them, which is the defect `ParamsEditor` already fixed for its tables. A control that
 * is naturally narrow (a number, a select) sizes itself.
 */
export function FormRow({
  label,
  hint,
  children,
}: {
  label: string
  /** One quiet line under the label saying what the setting does. */
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="grid min-h-11 grid-cols-[10rem_minmax(0,1fr)] items-center gap-3 border-b border-border-faint px-3 py-1.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-text-soft">{label}</span>
        {hint && <span className="block text-2xs text-text-faint">{hint}</span>}
      </span>
      <span className="block min-w-0">{children}</span>
    </label>
  )
}
