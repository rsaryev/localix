import type { RailRecentsMode } from '@/shared/lib/railRecentsPref'
import type { RailEntry } from '../ui/shellTypes'

/**
 * How the rail's recent slots split between what stays on the rail and what hides
 * behind the disclosure button — the presentation half of railRecents.
 */
export interface RecentsDisclosure {
  /** Rendered in the rail itself, in recency order. */
  visible: RailEntry[]
  /** Rendered inside the flyout, in recency order. */
  collapsed: RailEntry[]
}

/**
 * Split recent entries per the user's preference.
 *
 * In `hover` mode EVERYTHING collapses, the active view included: the dock's whole
 * promise is that the rail's icon count never moves, and letting the open view out
 * would break exactly that on the most ordinary action there is — opening a view.
 * "You are here" is carried by the trigger instead, which wears the active view's
 * own icon and active styling (see RailRecentsDock).
 *
 * Pure: no React, no DOM, cheap enough to run per render.
 */
export function splitRecents(
  entries: readonly RailEntry[],
  mode: RailRecentsMode,
): RecentsDisclosure {
  if (mode === 'off') return { visible: [], collapsed: [] }
  if (mode === 'expanded') return { visible: [...entries], collapsed: [] }
  return { visible: [], collapsed: [...entries] }
}
