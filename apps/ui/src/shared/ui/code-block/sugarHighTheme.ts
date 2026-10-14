/**
 * sugar-high token colors, mapped onto the shared `--syntax-*` design tokens.
 *
 * These used to carry hardcoded hex per class WITH `dark:` variants. Two problems,
 * both fixed by pointing them at tokens instead:
 *
 *  - a plugin theme could not reach them. Tailwind arbitrary properties set the
 *    custom property ON THIS CONTAINER, which shadows an `<html>`-level override —
 *    so a theme's `--sh-keyword` never won, even though the theme picker accepts it.
 *  - the light/dark pair lived here while every other colour pair lives in
 *    index.css, so the two could (and did) drift.
 *
 * The `dark:` variants are gone because they are no longer needed: `--syntax-*` is
 * already defined per theme in index.css, so ONE mapping serves both. Values are
 * unchanged — this is a redirection, not a restyle.
 */
export const SUGAR_HIGH_THEME = [
  '[--sh-identifier:var(--foreground)]',
  '[--sh-class:var(--syntax-class)] [--sh-sign:var(--syntax-sign)]',
  '[--sh-string:var(--syntax-string)] [--sh-keyword:var(--syntax-keyword)]',
  '[--sh-comment:var(--syntax-comment)] [--sh-jsxliterals:var(--syntax-literal)]',
  '[--sh-property:var(--syntax-property)] [--sh-entity:var(--syntax-entity)]',
].join(' ')

/**
 * The FILE VIEWER + inspector editor palette (the `bare` CodeBlock), so reading a
 * file and editing it render with identical colors — a claim this file already made
 * and only now keeps: Monaco used to carry a THIRD hardcoded palette of its own and
 * now reads these same `--syntax-code-*` tokens.
 */
export const CODE_VIEWER_HIGHLIGHT = [
  '[--sh-identifier:var(--foreground)] [--sh-sign:var(--text-soft)]',
  '[--sh-class:var(--syntax-code-class)] [--sh-string:var(--syntax-code-string)]',
  '[--sh-keyword:var(--syntax-code-keyword)] [--sh-comment:var(--syntax-code-comment)]',
  '[--sh-jsxliterals:var(--syntax-code-literal)] [--sh-property:var(--syntax-code-property)]',
  '[--sh-entity:var(--syntax-code-entity)]',
].join(' ')
