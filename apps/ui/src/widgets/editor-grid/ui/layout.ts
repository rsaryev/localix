import {
  findLeaf,
  leaves as treeLeaves,
  renormalize,
  type BranchNode,
  type GridNode,
  type LeafNode,
  type Orientation,
} from '@/entities/workspace-grid/model'
// Structural width/height minimums are owned by the model layer (single source of
// truth, also consumed by the placement column budget) and re-exported here so the
// renderer's existing importers keep resolving them from './layout'.
import {
  BASE_DIMS,
  scaleDims,
  minWidthOf,
  minHeightOf,
  type GridDims,
} from '@/entities/workspace-grid/model'

export { BASE_DIMS, scaleDims, minWidthOf, minHeightOf, type GridDims }

/** A box in percent (0–100) of the grid container. */
export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface LeafSlot {
  leaf: LeafNode
  rect: Rect
  /** Hidden (kept mounted but offscreen) — used when another group is maximized. */
  hidden: boolean
}

export interface SeparatorSlot {
  /** Stable key: branch id + boundary index. */
  key: string
  branch: BranchNode
  /** Index of the child on the LEFT/TOP side of this boundary. */
  index: number
  orientation: Orientation
  /** The branch's own box — the drag handler converts a px delta into a fraction
   *  of this box's span along the split axis. */
  branchRect: Rect
  rect: Rect
}

export interface GridLayout {
  leaves: LeafSlot[]
  separators: SeparatorSlot[]
}

const SEP = 1 // separator thickness, in percent (visually a hairline; hit area is wider via CSS).

/** Fraction of a branch's span the children's minimums may collectively occupy.
 *  The rest is always free play, so a split is NEVER pinned (un-resizable) — the
 *  "panel won't drag" symptom when role minimums (e.g. editor 360 + aux 340 = 700)
 *  nearly fill a laptop-width grid. */
const MIN_SPAN_BUDGET = 0.8

/** Cap one child's minimum so `childCount` children can't sum past the budget of a
 *  `spanPx`-wide branch — leaving a guaranteed resizable margin. On a roomy branch
 *  the cap doesn't bind and the full role minimum applies. */
export function capMin(minPx: number, spanPx: number, childCount: number): number {
  if (spanPx <= 0 || childCount <= 0) return minPx
  return Math.min(minPx, (spanPx * MIN_SPAN_BUDGET) / childCount)
}

/** Real pixel size of the grid container + the per-axis FALLBACK minimums for
 *  untagged groups. When omitted, computeLayout stays pure-fraction (tests). */
export interface LayoutConstraints {
  viewport: { width: number; height: number }
  minWidth?: number
  minHeight?: number
  /** Density-scaled minimums (`scaleDims(densityRatio())`). Omitted → the
   *  unscaled 14px-baseline constants (tests, default density). */
  dims?: GridDims
}

/**
 * Clamp fractional split sizes so no child falls below its minimum along the split
 * axis, given the branch's pixel `spanPx`. `minPx` is a single floor for every
 * child OR a per-child array (so a content-heavy panel can demand more than a code
 * editor beside it). Children under their min are raised to it and the deficit is
 * taken from siblings with headroom IN PROPORTION to that headroom (iterated, since
 * a donor can itself reach its floor). When the minimums can't all fit it splits
 * PROPORTIONAL to the minimums — so the bigger-min region still gets the larger
 * share, never an even split that re-crushes it. Returns fractions summing to 1.
 */
export function clampToMin(
  fractions: number[],
  spanPx: number,
  minPx: number | number[],
): number[] {
  const n = fractions.length
  if (n <= 1 || spanPx <= 0) return fractions
  const mins = (typeof minPx === 'number' ? fractions.map(() => minPx) : minPx).map((m) =>
    Math.max(0, m),
  )
  const totalMin = mins.reduce((a, b) => a + b, 0)
  if (totalMin <= 0) return fractions
  if (totalMin >= spanPx) return mins.map((m) => m / totalMin)
  const total = fractions.reduce((a, b) => a + Math.max(0, b), 0) || 1
  const sizes = fractions.map((f) => (Math.max(0, f) / total) * spanPx)
  for (let iter = 0; iter < n; iter++) {
    let deficit = 0
    for (let i = 0; i < n; i++)
      if (sizes[i] < mins[i]) {
        deficit += mins[i] - sizes[i]
        sizes[i] = mins[i]
      }
    if (deficit <= 1e-6) break
    let headroom = 0
    for (let i = 0; i < n; i++) if (sizes[i] > mins[i]) headroom += sizes[i] - mins[i]
    if (headroom <= 1e-6) break
    for (let i = 0; i < n; i++)
      if (sizes[i] > mins[i]) sizes[i] -= deficit * ((sizes[i] - mins[i]) / headroom)
  }
  const sum = sizes.reduce((a, b) => a + b, 0) || 1
  return sizes.map((s) => s / sum)
}

/**
 * Walk the split tree and assign every leaf an absolute box (in % of the grid
 * container), collecting the separators between branch children. Pure geometry —
 * no DOM measurement — so the flat render below never triggers a layout-effect
 * loop, and a leaf keeps its identity (and React subtree) no matter how the tree
 * restructures around it. That is what stops chat/terminal/preview from
 * remounting on a split.
 */
export function computeLayout(
  node: GridNode,
  rect: Rect = { left: 0, top: 0, width: 100, height: 100 },
  opts?: LayoutConstraints,
): GridLayout {
  if (node.type === 'leaf') {
    return { leaves: [{ leaf: node, rect, hidden: false }], separators: [] }
  }
  const branch = node
  const horizontal = branch.orientation === 'h'
  let fractions = renormalize(
    branch.sizes.length === branch.children.length ? branch.sizes : branch.children.map(() => 1),
  )
  // Enforce minimum pixel sizes when a real viewport is known — this is what stops
  // a deeply-split panel from being crushed to a sliver. Each child carries its own
  // minimum (its subtree's role-derived need), so a content-heavy panel keeps more
  // width than a code editor beside it.
  if (opts) {
    const spanPx = horizontal
      ? (rect.width / 100) * opts.viewport.width
      : (rect.height / 100) * opts.viewport.height
    const dims = opts.dims ?? BASE_DIMS
    const mins = branch.children.map((c) =>
      capMin(
        horizontal
          ? minWidthOf(c, opts.minWidth ?? dims.minGroupW, dims.roleMinW)
          : minHeightOf(c, opts.minHeight ?? dims.minGroupH),
        spanPx,
        branch.children.length,
      ),
    )
    fractions = clampToMin(fractions, spanPx, mins)
  }
  const out: GridLayout = { leaves: [], separators: [] }
  const span = horizontal ? rect.width : rect.height
  let offset = horizontal ? rect.left : rect.top

  branch.children.forEach((child, i) => {
    const size = fractions[i] * span
    const childRect: Rect = horizontal
      ? { left: offset, top: rect.top, width: size, height: rect.height }
      : { left: rect.left, top: offset, width: rect.width, height: size }
    const sub = computeLayout(child, childRect, opts)
    out.leaves.push(...sub.leaves)
    out.separators.push(...sub.separators)
    offset += size
    if (i < branch.children.length - 1) {
      out.separators.push({
        key: `${branch.id}:${i}`,
        branch,
        index: i,
        orientation: branch.orientation,
        branchRect: rect,
        rect: horizontal
          ? { left: offset - SEP / 2, top: rect.top, width: SEP, height: rect.height }
          : { left: rect.left, top: offset - SEP / 2, width: rect.width, height: SEP },
      })
    }
  })
  return out
}

/** Full-size box for a maximized group; all other leaves stay mounted but hidden.
 *  Every leaf gets the full rect — visibility (not geometry) is what differs, so
 *  GridView's hidden style override is the only thing that hides the others. */
export function maximizedLayout(root: GridNode, maximizedId: string): GridLayout {
  const full: Rect = { left: 0, top: 0, width: 100, height: 100 }
  return {
    leaves: computeLayout(root).leaves.map(({ leaf }) => ({
      leaf,
      rect: full,
      hidden: leaf.id !== maximizedId,
    })),
    separators: [],
  }
}

export interface ResolveGridLayoutOptions {
  isMobile: boolean
  activeGroup: string
  maximizedGroup: string | null
  constraints?: LayoutConstraints
}

/**
 * Responsive layout policy over the persistent split tree.
 *
 * Mobile shows the focused group full-size but keeps every sibling mounted and hidden, so changing
 * breakpoint never mutates or loses the user's desktop layout. Desktop honors explicit maximize,
 * then falls back to ordinary split geometry.
 */
export function resolveGridLayout(root: GridNode, options: ResolveGridLayoutOptions): GridLayout {
  const mobileGroup = findLeaf(root, options.activeGroup)?.id ?? treeLeaves(root)[0]?.id
  if (options.isMobile && mobileGroup) return maximizedLayout(root, mobileGroup)
  if (options.maximizedGroup && findLeaf(root, options.maximizedGroup)) {
    return maximizedLayout(root, options.maximizedGroup)
  }
  return computeLayout(root, undefined, options.constraints)
}
