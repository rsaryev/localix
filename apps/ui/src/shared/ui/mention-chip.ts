/**
 * The inline mention chip — `@agent` or `@file` rendered inside message text.
 *
 * Three components spelled this shape by hand, two of them byte-for-byte, and neither clickable one
 * carried a focus indicator: a keyboard user tabbing through a message landed on a button that did
 * not show it was focused. One recipe fixes both — the geometry cannot drift between the three, and
 * the interactive tone owns `focus-ring` so a new mention kind inherits it.
 *
 * Sized to sit on the text baseline (`align-baseline`, `py-0.5`, `text-xs`) so a mention reads as
 * part of the sentence rather than a control dropped into it.
 */
const MENTION_CHIP_BASE =
  'inline-flex max-w-full items-center rounded-md px-1.5 py-0.5 align-baseline text-xs ring-1'

export const MENTION_CHIP = {
  /** A mention that navigates — an agent's profile, a file. */
  link: `${MENTION_CHIP_BASE} gap-1 bg-surface-hover font-medium text-text-strong ring-border/60 outline-none transition-colors hover:bg-surface-active focus-ring`,
} as const
