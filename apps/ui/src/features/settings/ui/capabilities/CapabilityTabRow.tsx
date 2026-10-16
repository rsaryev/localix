import type { ReactNode } from 'react'
import { TabBar, type TabItem } from '@localixai/kit/tabs'

/**
 * The Capabilities navigation row: the tab strip plus whatever control belongs
 * on the same line as it (today, the scope picker).
 *
 * It exists so the relationship between those two is stated once instead of
 * measured by eye. The strip and the picker are different heights, and the page
 * used to line them up with a padding nudge on the picker, hand-tuned against
 * the strip's own bottom padding — a number that silently went wrong whenever
 * either control's height changed.
 *
 * Both the alignment and the rule under the row are now `TabBar`'s: the picker
 * goes in its `trailing` slot, which centres it in the same one-token band as the
 * tabs and lets the strip's own seam run the full width. This file previously had
 * to cancel that seam and redraw it on a wrapper — two declarations of one line,
 * which is exactly what drifts. Nothing geometric is left here.
 */
export function CapabilityTabRow<T extends string>({
  'aria-label': ariaLabel,
  items,
  active,
  onChange,
  trailing,
}: {
  /**
   * Accessible name for the tab strip. Spelled as the ARIA attribute, not a
   * `label` prop, so the name stays greppable at the call site — the workbench
   * foundations guard reads every tablist's name from the file that mounts it.
   */
  'aria-label': string
  items: TabItem<T>[]
  active: T
  onChange: (id: T) => void
  /** Optional control aligned with the strip on the right of the row. */
  trailing?: ReactNode
}) {
  return (
    <TabBar
      aria-label={ariaLabel}
      items={items}
      active={active}
      onChange={onChange}
      trailing={trailing == null ? undefined : <div className="pl-3">{trailing}</div>}
    />
  )
}
