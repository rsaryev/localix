/**
 * How many contributed status items the titlebar shows, and how wide each may be.
 *
 * The cluster used to answer this with one number — show four, fold the rest into `…` — on a
 * window of any size. With eighteen bundled plugins that meant a maximised display showing four
 * glyphs and hiding seven, while a narrow window showed the same four and pushed the breadcrumb
 * into nothing. A cap is the right IDEA (a bar that grows until the path has nowhere left to
 * truncate is worse than a menu) but the number belongs to the available width.
 *
 * The model has two levers a flat cap did not:
 *
 *   - an item can DROP ITS TEXT. Contributed items are icon + optional live text + badge, and the
 *     text is what makes them ~104px instead of ~28px. So a tight strip shows MORE plugins by
 *     showing each one smaller, and what it drops moves into the tooltip, where nothing is lost.
 *     Icon-only is also the macOS status-bar reading — glyphs at a stable pitch, detail on demand;
 *   - the row's OTHER tenants are known. The titlebar holds three things: the navigation trail on
 *     the left, this strip, and a fixed core cluster (terminal, browser, bell) pinned right. The
 *     first is the only one whose appetite varies, and it varies with something this file can be
 *     told — how deep the session path currently is. A share of the row was a stand-in for that
 *     fact; asking for the fact directly is what lets a shallow path hand the strip the room it
 *     was never using, and a deep one take it back.
 *
 * Pure, so the whole decision is unit-testable without a DOM; the measurement is
 * {@link useElementWidth}'s job and the depth is the breadcrumb's.
 */

/**
 * The physical measures the strip is laid out on, in px.
 *
 * `compact` and `overflow` are `--chrome-control-md`, the token every chrome action already uses,
 * and `gap` is the row's `gap-0.5`. `roomy` is the widest an item with live text asks for — a
 * 28px glyph, the `max-w-32` text cap and a badge — so it is an upper bound, never a measurement:
 * an item that renders narrower simply leaves room, which can only ever mean MORE items fit than
 * this model promised.
 *
 * `core` and `crumb` are the row's other tenants, in the same currency. `core` is the three fixed
 * buttons plus the rule that fences them off; `crumb` is what one navigation segment asks for
 * before it starts truncating — a label button and its separator.
 */
export const STATUS_STRIP_METRICS = {
  gap: 2,
  compact: 28,
  roomy: 104,
  overflow: 28,
  core: 3 * 28 + 2 * 2 + 11,
  crumb: 116,
} as const

/**
 * The most of the titlebar the strip may claim, however much room the trail leaves it.
 *
 * Half. The plugin glyphs grow leftwards from the fixed cluster on the right, so this is the
 * literal centre of the window — a bar whose plugins reached past it would read as the plugins'
 * bar with a path squeezed into the corner, whatever the measurements said was possible.
 */
export const STRIP_MAX_SHARE = 0.5

/**
 * What the trail keeps once it has yielded everything it is going to.
 *
 * Below this the strip stops taking room and the breadcrumb stops shrinking — the window is simply
 * too narrow for both, and the answer is `…`, not a path abbreviated past reading.
 */
export const BREADCRUMB_FLOOR = 180

/**
 * The strip never disappears entirely: four glyphs and the `…` that carries the rest.
 *
 * An empty strip and a broken plugin host look identical from the user's chair, and the trail can
 * truncate — that is what its `minmax(0,1fr)` column is FOR — where the strip can only vanish.
 */
export const STRIP_FLOOR =
  4 * STATUS_STRIP_METRICS.compact + 4 * STATUS_STRIP_METRICS.gap + STATUS_STRIP_METRICS.overflow

/**
 * What the strip renders before the first measurement lands.
 *
 * It used to be a flat four, which made the pre-measurement frame the one users actually saw: a
 * titlebar that had ten plugin glyphs to show opened with four and an `…`, and only a resize (or
 * a lucky re-render) ever replaced it. Four was also the wrong guess in the one direction that
 * costs something — folding items away is the destructive half of this decision, and guessing it
 * before measuring anything is a fold nobody asked for.
 *
 * So the unmeasured frame shows EVERY item, as glyphs. Compact is the layout that fits at any
 * width a titlebar can plausibly have (28px a piece), so the first paint can never overflow its
 * box, and the measurement that follows can only ever give the items their text back.
 */
export const UNMEASURED_COMPACT = true

export interface StatusStripFit {
  /** How many items to render inline; the rest go to the overflow menu. */
  visible: number
  /** Render each visible item icon-only, with its live text moved into the tooltip. */
  compact: boolean
}

export interface StatusStripFitInput {
  /** Width of the strip's host row in px, or `null` before the first measurement. */
  containerWidth: number | null
  /** How many items want a slot. */
  count: number
  /** Hard ceiling regardless of room — twenty glyphs is a menu, however wide the window. */
  max: number
  /**
   * How many crumbs the navigation trail is drawing — the strip's only competitor for this row.
   *
   * Depth rather than a measured width, because the trail's box is the grid's `minmax(0,1fr)`
   * remainder: it is as wide as whatever this function leaves it, so measuring it and then sizing
   * on the measurement is a loop. Depth is upstream of both.
   *
   * Absent → assume the deepest trail the breadcrumb expands to, which is the conservative guess:
   * it can only make the strip narrower than the truth.
   */
  breadcrumbDepth?: number
}

/** The deepest trail the breadcrumb draws — scope, root session and its expanded sub-sessions. */
const DEEPEST_TRAIL = 5

/** How many boxes of `itemWidth` fit into `width`, counting the gaps between them. */
function countThatFit(width: number, itemWidth: number, gap: number): number {
  if (width < itemWidth) return 0
  return Math.floor((width + gap) / (itemWidth + gap))
}

/**
 * The px the strip may spend on one measured row.
 *
 * Exported because it is the interesting half: `fitStatusStrip` only turns a number of pixels into
 * a number of glyphs, while THIS is where the three tenants of the titlebar are reconciled.
 */
export function statusStripBudget(
  containerWidth: number,
  breadcrumbDepth: number = DEEPEST_TRAIL,
): number {
  const { core, crumb } = STATUS_STRIP_METRICS
  // What the trail wants, capped at half the row — a very deep path is the breadcrumb's problem to
  // truncate, not a reason to leave the strip nothing.
  const trail = Math.max(
    BREADCRUMB_FLOOR,
    Math.min(Math.max(0, breadcrumbDepth) * crumb, containerWidth * 0.5),
  )
  const free = containerWidth - core - trail
  const ceiling = Math.min(containerWidth * STRIP_MAX_SHARE, containerWidth - core)
  return Math.max(0, Math.floor(Math.min(Math.max(free, STRIP_FLOOR), ceiling)))
}

/**
 * Decide the strip's layout for one measured width.
 *
 * Three outcomes, in the order a reader would rank them:
 *   1. everything fits with its live text  → show it all, roomy;
 *   2. everything fits icon-only           → show it all, compact (the text is in the tooltip);
 *   3. it does not fit                     → compact, and the excess folds into `…`.
 *
 * Text is all-or-nothing on purpose. Letting only the first few keep their text would make an
 * item's width depend on its POSITION, so enabling one plugin would silently re-shape another —
 * and the strip would have to re-measure itself to know its own layout. One rule, no feedback.
 */
export function fitStatusStrip({
  containerWidth,
  count,
  max,
  breadcrumbDepth,
}: StatusStripFitInput): StatusStripFit {
  const ceiling = Math.max(0, Math.min(count, max))
  if (ceiling === 0) return { visible: 0, compact: false }
  if (containerWidth === null) return { visible: ceiling, compact: UNMEASURED_COMPACT }

  const { gap, compact, roomy, overflow } = STATUS_STRIP_METRICS
  const available = statusStripBudget(containerWidth, breadcrumbDepth)
  const showsEverything = ceiling === count

  if (showsEverything && countThatFit(available, roomy, gap) >= count) {
    return { visible: count, compact: false }
  }
  if (showsEverything && countThatFit(available, compact, gap) >= count) {
    return { visible: count, compact: true }
  }
  // Something folds, so the `…` trigger needs a slot of its own before the items get theirs.
  const forItems = available - overflow - gap
  return {
    visible: Math.min(ceiling, countThatFit(forItems, compact, gap)),
    compact: true,
  }
}
