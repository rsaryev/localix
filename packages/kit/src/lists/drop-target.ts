/**
 * One visual vocabulary for every native drag-and-drop destination.
 *
 * Behaviour stays with each feature (files move, tabs split, resources link,
 * terminal paths paste). These classes only standardize the feedback:
 *
 * - surface: a bounded card/input/column accepting the drop;
 * - inset: a target inside an existing surface (tree row, rail, tab strip);
 * - overlay: a full-pane shield such as editor split or terminal paste;
 * - indicator: the exact insertion position between ordered items.
 *
 * The glow intentionally matches the focused chat composer. New drop targets
 * should consume one of these variants instead of inventing another border.
 */

import { POPOVER_MATERIAL } from '../overlays/popover-surface'

export const DROP_TARGET_TRANSITION =
  'transition-[border-color,box-shadow,background-color,opacity] duration-(--dur-fast)'

export const DROP_TARGET_FOCUS_GLOW =
  'border-control-border-focus shadow-[0_0_0_1px_var(--surface-hover),var(--shadow-soft)]'

export const DROP_TARGET_SURFACE_ACTIVE =
  'border-control-border-focus bg-surface-hover/30 shadow-[0_0_0_1px_var(--surface-hover),var(--shadow-soft)]'

export const DROP_TARGET_INSET_ACTIVE =
  'bg-surface-hover/55 ring-2 ring-inset ring-control-border-focus shadow-[inset_0_0_20px_color-mix(in_oklch,var(--foreground),transparent_94%)]'

export const DROP_TARGET_OVERLAY_ACTIVE =
  'border-2 border-dashed border-control-border-focus lx-occluder shadow-[inset_0_0_28px_color-mix(in_oklch,var(--foreground),transparent_93%),0_0_0_1px_var(--surface-hover)]'

export const DROP_TARGET_HINT = `${POPOVER_MATERIAL} rounded-lg border border-control-border-focus px-3 py-1.5 text-xs font-medium text-foreground`

// The insertion line's glow is `--drop-indicator-glow` (theme tokens), not a literal: the five
// indicators below each spelled the same arbitrary shadow, and a string constant cannot carry it
// because each one needs it under a different variant (`before:` / `after:`), which Tailwind only
// sees when the class is written out whole.
export const DROP_TARGET_INDICATOR = 'bg-foreground shadow-(--drop-indicator-glow)'

export const DROP_TARGET_INDICATOR_BEFORE_VERTICAL =
  'before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-foreground before:shadow-(--drop-indicator-glow)'

export const DROP_TARGET_INDICATOR_AFTER_VERTICAL =
  'after:absolute after:inset-y-1 after:right-0 after:w-0.5 after:rounded-full after:bg-foreground after:shadow-(--drop-indicator-glow)'

export const DROP_TARGET_INDICATOR_BEFORE_HORIZONTAL =
  'before:absolute before:inset-x-1 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-foreground before:shadow-(--drop-indicator-glow)'

export const DROP_TARGET_INDICATOR_AFTER_HORIZONTAL =
  'after:absolute after:inset-x-1 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-foreground after:shadow-(--drop-indicator-glow)'

export const DROP_TARGET_SLOT =
  'border-control-border-focus bg-surface-hover/55 text-foreground shadow-[0_0_14px_color-mix(in_oklch,var(--foreground),transparent_86%)]'
