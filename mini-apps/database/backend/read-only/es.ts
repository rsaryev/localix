/**
 * Pure Elasticsearch read/write classifier for the read-only connection guard-rail.
 *
 * The search console's grammar is `<index>.<method>(<args>)` over exactly three methods
 * ({@link ../drivers/es-query.ES_METHODS}: search / count / get), and all three read. So
 * this classifier is genuinely "parses ⇒ reads" today — unlike Mongo's, where `aggregate`
 * hides `$out`. It still exists rather than being inlined as `true` for two reasons: the
 * guard must reject an UNPARSEABLE command (we cannot prove what we cannot parse), and it
 * is the one place to revisit when a writing method (`index`, `bulk`, `delete`) is added
 * to `ES_METHODS` — the registry entry then keeps working instead of silently permitting
 * the new write.
 *
 * Same fail-safe contract as the SQL classifier: anything not PROVEN to be a pure read
 * returns `false`.
 */

import { type EsMethod, parseEsCommand } from '../drivers/es-query'

/** Methods that only read. Every member of `ES_METHODS` is listed; see the note above. */
const READ_METHODS = new Set<EsMethod>(['search', 'count', 'get'])

/** True only if `command` is PROVEN to be a pure Elasticsearch read. */
export function isReadOnlyEsCommand(command: string): boolean {
  try {
    return READ_METHODS.has(parseEsCommand(command).method)
  } catch {
    return false
  }
}
