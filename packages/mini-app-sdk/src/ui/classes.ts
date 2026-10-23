import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Keyboard-focus treatment for a directly focused form control. Keep this in
 * the SDK so host and mini app UI use one visible contract instead of restyling
 * `outline-none` inputs independently.
 *
 * One INSET hairline, and nothing else. Three earlier spellings all read as a collar rather than
 * an indicator: `ring-2` is an OUTWARD box-shadow in Tailwind v4, so a focused field grew a 2px
 * halo outside its own box on top of a repainted 1px border — ~3px of hard edge. Painting that
 * halo in `--ring` made it worse in both appearances, since `--ring` is deliberately monochrome
 * (app identity): 0.7 on the near-black dark shell is a light grey that reads as white, and 0.4
 * on light's near-white shell is a near-black collar. `ring-inset` at 1px in
 * `--control-border-focus` is the same weight as the hairline the control already has, cannot be
 * clipped by an `overflow-hidden` strip, and never changes the control's footprint. The border
 * itself is left alone, so focus adds an edge instead of recolouring one.
 */
export const CONTROL_FOCUS_VISIBLE =
  'outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-control-border-focus'

/**
 * Keyboard-focus treatment for an input group whose child owns DOM focus.
 *
 * `has-[:focus-visible]`, NOT `focus-within`: `:focus-within` has no keyboard-only semantics, so
 * every click into a search box lit the indicator up — the one thing `focus-ring` exists to avoid
 * ("keyboard-only, so mouse clicks stay clean"). `:has()` lets the wrapper ask the question the
 * focused CHILD answers, which is the only way to reach `:focus-visible` from a parent.
 */
export const CONTROL_FOCUS_WITHIN =
  'has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-control-border-focus'

/**
 * The invalid state of a form control (`aria-invalid`), for every control that can carry one.
 *
 * It was transcribed into six primitives, and the copies had already drifted: the checkbox had
 * lost its dark-theme border, the switch both dark variants, so an invalid switch in the dark
 * theme drew the light theme's ring. One constant, interpolated like the focus recipe above,
 * means an invalid control reads the same whichever control it is.
 */
export const CONTROL_INVALID =
  'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40'

/**
 * The resting shell of anything you TYPE INTO — an input, a textarea, a select trigger, an input
 * group: the control radius, the control hairline and the field fill. Five primitives spelled it
 * out; a field is recognisable as a field because they agree, so they share it rather than
 * agreeing by coincidence.
 */
export const FIELD_SURFACE = 'rounded-md border border-control-border bg-field-fill'

/** Merge conditional class values and resolve conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Constrain a number to the inclusive `[min, max]` range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
