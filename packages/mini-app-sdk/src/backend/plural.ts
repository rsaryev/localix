/**
 * ENGLISH PLURALIZATION — the `${n} thing${n === 1 ? '' : 's'}` idiom, owned once.
 *
 * It was hand-rolled eleven times across this app, in prompt text, digests, resource
 * expansions and logs. Eleven copies of a one-line rule is not a crisis, but it is
 * eleven chances to write `n > 1` where the rule is `n === 1` — which silently renders
 * "0 dep" instead of "0 deps", in text a MODEL reads.
 *
 * DELIBERATELY DUMB: this appends an `s`. It cannot spell "2 matches", "2 entries" or
 * "2 people". That is a feature, not a gap — a caller whose noun is irregular must SEE
 * that this helper does not fit, rather than get a plausible-looking wrong word from a
 * heuristic. Pass a noun that pluralizes with a bare `s`, or write the string out.
 */

/** The noun, pluralized: `pluralize('file', 2)` → `'files'`. Count NOT included. */
export function pluralize(noun: string, count: number): string {
  return `${noun}${count === 1 ? '' : 's'}`
}

/** Count + pluralized noun: `plural(2, 'file')` → `'2 files'`, `plural(1, 'file')` → `'1 file'`. */
export function plural(count: number, noun: string): string {
  return `${count} ${pluralize(noun, count)}`
}
