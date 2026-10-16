/**
 * POSIX single-quote wrapping — the ONE implementation of "make this string one shell word".
 *
 * A quoter copied into each caller drifts: one copy forgets the embedded-quote case and a path like
 * `it's` closes the quote early, which is a command-injection hole, not a cosmetic bug. So every
 * side imports this leaf: the API (`agent-core/tools/environment.ts` re-exports it), plugin
 * backends (`@localixai/plugin-sdk/backend`) and browser code (`@localixai/plugin-sdk/ui/utilities`).
 *
 * Inside single quotes no character is special, so the value is taken literally — `$VAR`,
 * `${secret:KEY}`, backticks and globs all survive verbatim. The one character single quotes cannot
 * hold is `'` itself: close the quote, emit an escaped quote, reopen (`'\''`).
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
