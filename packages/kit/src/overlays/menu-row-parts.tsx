import { Check } from 'lucide-react'
import { MENU_TRAILING_INDICATOR } from './popover-surface'

/**
 * The label column and the trailing radio check of a menu row, shared by every list of choices.
 *
 * The defect they close: `Select` drew its own option row — an absolutely placed check at
 * `right-2`, a `pr-7` reserve for it, no line under the label — while `MenuEntries` drew a
 * `selected` row with the check at the end of the flex row and the meaning as a line under the
 * name. The same "one of these" looked two ways depending on whether it was a form field or a
 * chrome menu, and only one of them could say what an option meant. Both now render these.
 */

/** Label, and when given the sentence under it that says what choosing the row means. */
export function MenuRowLabel({ label, description }: { label: string; description?: string }) {
  if (!description) return <span className="min-w-0 flex-1 truncate">{label}</span>
  // A sentence wraps under its label rather than truncating beside it; the row grows, which
  // `MENU_ITEM`'s min-height allows.
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate">{label}</span>
      <span className="text-2xs text-text-faint">{description}</span>
    </span>
  )
}

/**
 * The check at the END of a single-choice row. Rendered on EVERY row of the list, empty on the
 * unchosen ones, so each row's trailing edge ends on one column.
 */
export function MenuTrailingCheck({ selected }: { selected: boolean }) {
  return (
    <span className={MENU_TRAILING_INDICATOR}>
      {selected ? <Check aria-hidden="true" className="size-3" strokeWidth={2.5} /> : null}
    </span>
  )
}
