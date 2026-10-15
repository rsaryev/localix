/**
 * The look of each `TabStrip` variant, as one table instead of nested ternaries in the render.
 */

export type TabStripVariant = 'primary' | 'underline' | 'compact'

interface VariantClasses {
  /** The strip row: its height and gutters. */
  row: string
  /** Every tab: size, type and its focus fill. */
  tab: string
  active: string
  inactive: string
  /** The close button stays visible on inactive tabs (primary/underline rows). */
  closeAlwaysVisible: boolean
}

const PRIMARY: VariantClasses = {
  row: 'h-[var(--chrome-control-touch)] px-2',
  tab: 'h-[var(--chrome-control-lg)] max-w-56 rounded-sm px-(--workbench-gutter) text-sm font-normal leading-none focus-within:bg-surface-hover/40 focus-within:text-foreground',
  active:
    'text-foreground after:absolute after:inset-x-2 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-foreground',
  inactive:
    'text-text-soft hover:bg-surface-hover/50 hover:text-foreground focus-within:after:absolute focus-within:after:inset-x-2 focus-within:after:-bottom-1 focus-within:after:h-px focus-within:after:rounded-full focus-within:after:bg-ring/70',
  closeAlwaysVisible: true,
}

const UNDERLINE: VariantClasses = {
  row: 'h-[var(--chrome-control-lg)] px-1.5',
  tab: 'h-[var(--chrome-control-sm)] max-w-44 rounded-sm px-2 text-2xs font-medium leading-none focus-within:bg-surface-hover/40 focus-within:text-foreground',
  active:
    'bg-surface-hover/60 text-foreground after:absolute after:inset-x-1.5 after:-bottom-1 after:h-px after:rounded-full after:bg-foreground/80',
  inactive:
    'text-text-soft hover:bg-surface-hover/50 hover:text-foreground focus-within:after:absolute focus-within:after:inset-x-1.5 focus-within:after:-bottom-1 focus-within:after:h-px focus-within:after:rounded-full focus-within:after:bg-ring/70',
  closeAlwaysVisible: true,
}

const COMPACT: VariantClasses = {
  row: 'h-[var(--chrome-control-md)] px-1.5',
  tab: 'h-[var(--chrome-control-sm)] rounded-sm px-1.5 text-2xs focus-within:bg-surface-hover focus-within:text-foreground',
  // Brighter text alone left the active tab nearly indistinguishable from an inactive one when
  // the group is unfocused. A filled `surface-active` rest state reads as clearly selected and
  // stays distinct from the `surface-hover` used for inactive hover, in both light and dark.
  active: 'bg-surface-active text-foreground',
  inactive: 'text-text-soft hover:bg-surface-hover hover:text-foreground',
  closeAlwaysVisible: false,
}

export const TAB_STRIP_VARIANTS: Readonly<Record<TabStripVariant, VariantClasses>> = {
  primary: PRIMARY,
  underline: UNDERLINE,
  compact: COMPACT,
}

/** Width of the TabStrip edge fades; the reveal holds a revealed tab clear of them. */
export const EDGE_FADE_WIDTH = 24
/**
 * Width of the TabBar scroll chevrons. These are OPAQUE and clickable, so a tab revealed
 * underneath one is not merely dim — it is unclickable, which is how the last tab became
 * impossible to select.
 */
export const SCROLL_AFFORDANCE_WIDTH = 32
/** Horizontal inset of the TabBar's sliding underline from its tab's edges. */
export const INDICATOR_INSET = 8
