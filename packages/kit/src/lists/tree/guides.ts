import type { CSSProperties } from 'react'

/**
 * Tree indent guides: a faint vertical rail under each ancestor
 * folder. Drawn per-row as a repeating gradient (one 1px line every GUIDE_STEP
 * px, starting under the depth-0 chevron) clipped to this row's indent width,
 * so the lines from consecutive rows stack into continuous vertical rails.
 * Depth 0 rows (top level) get none. Coexists with the row's hover/selected
 * background-color. Shared by the Files sidebar and the Source Control changes
 * tree (both use the same 12px indent step, so guides align across the two).
 * The `--tree-guide` color token lives in app/index.css.
 */
export const GUIDE_STEP = 12
export const GUIDE_X = 15

export function indentGuideStyle(depth: number): CSSProperties {
  if (depth < 1) return {}
  return {
    backgroundImage: `repeating-linear-gradient(to right, var(--tree-guide) 0 1px, transparent 1px ${GUIDE_STEP}px)`,
    backgroundPosition: `${GUIDE_X}px 0`,
    backgroundSize: `${depth * GUIDE_STEP}px 100%`,
    backgroundRepeat: 'no-repeat',
  }
}
