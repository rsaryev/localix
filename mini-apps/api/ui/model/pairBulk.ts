/**
 * Pure helpers behind the PairEditor's "Bulk edit" mode — the flip between a row-by-row grid and
 * a single textarea where each line is one pair. Framework-free (no React) for the same reason
 * `bodyEditor.ts` is: the editor layer adapts them, and units test the round-trip directly.
 *
 * The text grammar is `name: value` per line, and a leading `#`
 * disables that row without deleting it — the toggle a checkbox is in grid mode. This is a
 * lossy-by-design view (see `textToPairs`), never a persisted format: it exists only so a user
 * can paste a block of headers instead of clicking "Add" fifteen times.
 */

import type { Pair } from '../../backend/request-spec'

/**
 * Pairs → one `name: value` line each, `#`-prefixed when the row is disabled. The inverse of
 * `textToPairs` on well-formed pairs, so a round-trip through the textarea is identity. We emit
 * `: ` (colon-space) for readability even though the parser also accepts `=`; empty pairs still
 * get a line so the grid's row count survives the flip.
 */
export function pairsToText(pairs: readonly Pair[]): string {
  return pairs.map((p) => `${p.disabled ? '#' : ''}${p.name}: ${p.value}`).join('\n')
}

/**
 * Text → pairs, the inverse of `pairsToText`. Each non-blank line becomes one pair:
 *   - a leading `#` (after optional surrounding whitespace) marks the row `disabled`, then is
 *     stripped before the name/value split — same as unchecking the box in grid mode;
 *   - the line splits on its FIRST `:` OR `=`, whichever appears earliest, so a value may itself
 *     contain either delimiter (`Authorization: Bearer a:b` keeps `Bearer a:b`);
 *   - name and value are both trimmed; a line with no delimiter is all-name, empty value.
 * Blank lines are skipped — they carry no pair and would otherwise round-trip into empty rows.
 */
export function textToPairs(text: string): Pair[] {
  const pairs: Pair[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const disabled = line.startsWith('#')
    // Strip the `#` AND any space after it (`# name` and `#name` are the same disabled row).
    const body = disabled ? line.slice(1).trimStart() : line
    const colon = body.indexOf(':')
    const equals = body.indexOf('=')
    // Earliest present delimiter wins; -1 (absent) must lose to a real index, hence the guards.
    const at = colon === -1 ? equals : equals === -1 ? colon : Math.min(colon, equals)
    const name = at === -1 ? body : body.slice(0, at)
    const value = at === -1 ? '' : body.slice(at + 1)
    const pair: Pair = { name: name.trim(), value: value.trim() }
    if (disabled) pair.disabled = true
    pairs.push(pair)
  }
  return pairs
}
