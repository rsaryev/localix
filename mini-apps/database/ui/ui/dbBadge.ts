/**
 * The one chip recipe for small metadata tags in the database mini app (RO / SSH, an object's
 * engine badge, a column-match count, UNIQUE, a column flag).
 *
 * The defect it stops: the same veil was hand-transcribed five times and had already drifted —
 * one copy with a ring, one without vertical padding, one at `text-3xs`, one in `text-text-faint`
 * — so two tags on one row sat at different heights and weights. Every call site composes this
 * constant (plus `DB_BADGE_CAPS` for a word label) instead of restating the classes.
 *
 * Foreground veil, not `bg-surface-raised`: raised mixes from a DARKER ground than the sidebar and
 * panels these sit in, so a raised tag read as a black slot beside the text.
 */
export const DB_BADGE =
  'inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-foreground/[0.06] px-1 py-px text-2xs font-medium text-text-soft'

/** A WORD label (RO, SSH, UNIQUE, an engine type) rather than a count. */
export const DB_BADGE_CAPS = `${DB_BADGE} uppercase tracking-wide`
