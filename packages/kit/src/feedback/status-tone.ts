import type { StatusTone } from '@localixai/plugin-sdk/ui'

/**
 * The ways a tone is painted in the workbench chrome, in one place.
 *
 * These maps lived inside `NotificationCenterLauncher` and were the bell's private business until
 * contributed status items needed the same answers. Copying them would have been the second
 * implementation of one thing — the mistake this codebase keeps having to undo — so they moved up
 * instead. The bell now imports what it used to own.
 *
 * There was a fifth map here, `STATUS_SIGNAL_CLASS`: a status-coloured WASH over the whole
 * control, the "something just happened here" flash. Only the bell ever used it, and what it
 * actually did was paint a red plate under the bell glyph for 2.4 seconds — a chrome button
 * turning into a status surface. An icon-only control says "new, and how bad" with a badge in
 * its corner; the glyph itself stays chrome. The flash now belongs to that badge.
 */

/**
 * A solid badge: status fill with contrast text. Reads at counter size.
 *
 * `error` takes `text-background` like its siblings. It named `text-destructive-foreground`, which
 * has no `--color-` mapping, so Tailwind emitted nothing and the count inherited whatever text
 * colour surrounded the badge. Mapping it would not have been the repair either: that white is
 * paired with `--destructive`, and on the dark theme's lighter `--status-error` it falls under 3:1.
 * The ground colour is the pairing every status fill here was tuned against.
 */
export const STATUS_BADGE_CLASS: Record<Exclude<StatusTone, 'neutral'>, string> = {
  info: 'bg-status-info text-background',
  success: 'bg-status-success text-background',
  warning: 'bg-status-warning text-background',
  error: 'bg-status-error text-background',
}

/** Foreground only — a number or a glyph that carries state without a fill behind it. */
export const STATUS_TEXT_CLASS: Record<Exclude<StatusTone, 'neutral'>, string> = {
  info: 'text-status-info',
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
}

/** A dot's fill. Pairs with `StatusDot`, which takes its colour through `className`. */
export const STATUS_DOT_CLASS: Record<Exclude<StatusTone, 'neutral'>, string> = {
  info: 'bg-status-info',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
}

/** `neutral` means "no tone" — every map above is keyed by the four that actually paint. */
export function tonedClass(
  map: Record<Exclude<StatusTone, 'neutral'>, string>,
  tone: StatusTone | undefined,
): string | undefined {
  return tone && tone !== 'neutral' ? map[tone] : undefined
}
