import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { SELECTED_ROW } from '@localixai/kit/selected-row'

/**
 * The one geometry every column of the model picker is laid out on.
 *
 * WHY THIS EXISTS. The four columns used to pick their own insets — `p-2.5` + `px-3.5` in the
 * workload column, `p-2` + `px-2.5` in the provider rail, `p-1` + `px-3` in the model list,
 * `px-3.5` in the details panel — and their headers their own heights (36px beside a 28px
 * override). Nothing lined up: section labels, row text and header titles sat on four
 * different verticals, and the first divider ran at two different heights across the drawer.
 *
 * So the measure is stated once. A header title sits on the shared `--workbench-gutter` (12px).
 * A list body is inset 6px and a row pads its content 6px more, which puts every row's text on
 * that same 12px line while its hover fill still has room to breathe. A section label takes the
 * row's padding, so it starts where the row text does.
 */

/**
 * Where a side column renders. `column`: a fixed-width column of the drawer, from md up.
 * `sheet`: the same column inside the narrow layout's switcher popover (`CompactPickerNav`).
 */
export type PickerColumnLayout = 'column' | 'sheet'

/**
 * A side column's outer frame. The drawer's columns step with its width:
 *
 *   < md     model list only; workload and provider open as sheets from its header
 *   md–lg    workload · provider · models
 *   lg+      + the details column (`ModelDetailsSidePanel`)
 *
 * Below md the column is not rendered as a strip of chips — that squeezed every column into one
 * scrolling row and stacked five bands above the first model.
 */
export function pickerColumnFrame(layout: PickerColumnLayout, widths: string) {
  return layout === 'column'
    ? cn('flex shrink-0 flex-col border-r border-border-soft max-md:hidden', widths)
    : 'flex min-h-0 flex-1 flex-col'
}

/** A list body: the outer half of the gutter. */
export const PICKER_LIST = 'flex flex-col gap-px p-1.5'

/** A group heading's horizontal and bottom measure: the inner half of the gutter. */
export const PICKER_SECTION_LABEL_INSET = 'px-1.5 pb-1'

/** A group heading as a direct child of a list body: air above every group but the first. */
export const PICKER_SECTION_LABEL = `${PICKER_SECTION_LABEL_INSET} pt-3 first:pt-1.5`

/** The leading glyph slot, so a row with an icon and a row with a dot start text together. */
export const PICKER_ROW_LEADING = 'flex size-4 shrink-0 items-center justify-center'

/** Passive trailing metadata (a count, a connection name). */
export const PICKER_ROW_META = 'shrink-0 text-2xs tabular-nums text-text-faint'

/**
 * A single-line row of the picker, 32px — the `compact` row rung.
 *
 * Selected is the shared `SELECTED_ROW` fill made flat: the picker's columns separate by
 * dividers, so a selected row is a fill, never a lifted card (`shadow-none` drops the lift the
 * recipe carries for floating lists). Hover is `surface-hover`, the one 7% veil every list uses.
 */
export function pickerRow(active: boolean, className?: string) {
  return cn(
    'flex min-h-(--chrome-control-lg) w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-md px-1.5 text-left text-xs outline-none transition-colors duration-(--dur-fast) focus-ring',
    active
      ? cn(SELECTED_ROW, 'font-medium shadow-none')
      : 'text-text-soft hover:bg-surface-hover hover:text-foreground',
    className,
  )
}
