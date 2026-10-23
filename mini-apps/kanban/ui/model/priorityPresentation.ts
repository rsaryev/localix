/**
 * One owner for how a task's PRIORITY looks: its label, its glyph and its tone.
 *
 * The defect it closes: priority was drawn three ways on one board. A card showed `P+1` in the
 * warning tone, the Filters popover an ↑ / – / ↓ text mark with "high" in the ERROR tone, and the
 * create dialog coloured the chosen label red. The same "high" read as a warning on the card the
 * person was looking at and as a failure in the filter that selects it, so nothing told them those
 * were the same thing.
 *
 * So every surface reads this map: the card's chip, the filter menu's rows (an icon painted with
 * `tonedIcon`, which a menu row needs because the host renders its icon with no class of ours) and
 * the create dialog's priority control. High is the warning tone everywhere — it asks for
 * attention first, it is not an error.
 *
 * Keyed by the filter's three BUCKETS: the contract allows -2..2, and `priorityBucket` folds that
 * onto these the same way the filter does, so a card at +2 and the "High" filter row agree.
 */
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { tonedIcon, type IconComponent, type StatusTone } from '@localixai/mini-app-sdk/ui'

/** The three bands a -2..2 priority is filtered and drawn by. */
export type PriorityBucket = 'high' | 'normal' | 'low'

export interface PriorityPresentation {
  label: string
  /** The bare glyph, for a surface that sizes and tones it itself. */
  Icon: IconComponent
  tone: StatusTone
  /** The glyph already painted in `tone`: what a menu row and a card chip render. */
  icon: IconComponent
}

/** Highest first: the order the filter rows and the create dialog's options read in. */
export const PRIORITY_BUCKETS: readonly PriorityBucket[] = ['high', 'normal', 'low']

const present = (label: string, Icon: IconComponent, tone: StatusTone): PriorityPresentation => ({
  label,
  Icon,
  tone,
  icon: tonedIcon(Icon, tone),
})

export const PRIORITY_PRESENTATION: Record<PriorityBucket, PriorityPresentation> = {
  high: present('High', ArrowUp, 'warning'),
  normal: present('Normal', Minus, 'neutral'),
  low: present('Low', ArrowDown, 'neutral'),
}

/** The bucket a numeric priority falls in — the fold the filter selects by. */
export const priorityBucket = (priority: number): PriorityBucket =>
  priority > 0 ? 'high' : priority < 0 ? 'low' : 'normal'

/** A signed priority as text: `+1`, `-2`, `0`. */
export const signedPriority = (priority: number): string => `${priority > 0 ? '+' : ''}${priority}`
