/**
 * JSONPath over a response body — ONE implementation, used by the response pane AND by the agent
 * tool, because they are the same question asked by two callers.
 *
 * A filter box under the response is the difference between reading a 200 KB payload and reading
 * the one field you came for.
 *
 * For the AGENT it is worth more than convenience. A `send` whose response is a large document
 * puts the whole thing in the model's context, where it costs tokens on every subsequent turn of
 * the conversation. `{"action":"send","name":"x","filter":"$.data.token"}` returns the token.
 *
 * SECURITY: `eval: 'safe'` is passed EXPLICITLY, though it is also the library's default in v10.
 * A JSONPath may contain script expressions (`$[?(@.n > 2)]`), and the `native` mode evaluates
 * them with `eval`/`Function` — which is how this library's own CVE-2024-21534 worked, and the
 * expression here can come from a model. `safe` parses them with jsep instead: no `eval`, no
 * `Function`, and CSP-clean in the browser. Written down rather than inherited so a future change
 * of the library's default cannot silently turn scripting back on.
 *
 * The library's remaining documented risk is DATA EXPOSURE from a crafted query — a filter that
 * reads more of the payload than intended. That risk does not apply here: the payload is a
 * response the caller just fetched and can already read in full, so a broader match reveals
 * nothing it did not already have.
 *
 * WHAT COUNTS AS AN INVALID EXPRESSION is the library's call, and it is narrower than you would
 * guess — measured, not assumed. Only a broken SCRIPT expression (`$[?(`) throws. A broken PATH
 * is recovered from: `$$$` and `not a path` match nothing, while `$.data[` drops the dangling
 * bracket and quietly answers `$.data`. So a typo arrives as an ordinary result, sometimes even a
 * plausible one. Neither caller may therefore report "not found" — it cannot tell a typo from an
 * absent field, so it says "no matches" and shows the count.
 *
 * Requiring a leading `$` would catch the common typo — and it was tried and rejected, because
 * `a.b` is a REAL form this library accepts (implicit root), so the guard would have refused
 * expressions that work.
 */

import { JSONPath } from 'jsonpath-plus'

export type FilterOutcome =
  | { ok: true; content: string; matches: number }
  | { ok: false; error: string }

/** How many bytes of a non-JSON body to quote back when explaining the refusal. */
const PEEK = 60

/**
 * Apply `expression` to `body`.
 *
 * `body` is the raw response text. A body that is not JSON is a REFUSAL rather than an empty
 * result: "no matches" and "this was HTML" are different answers, and only one of them means the
 * expression was wrong.
 */
export function filterJson(body: string, expression: string): FilterOutcome {
  const path = expression.trim()
  if (path === '') return { ok: false, error: 'Enter a JSONPath expression, e.g. `$.data[0].id`.' }

  // `JSON.parse` yields `any`; narrowing it to what a JSON document can BE is what lets the
  // library's own parameter type accept it without a cast (`unknown` does not).
  let parsed: string | number | boolean | object | unknown[] | null
  try {
    parsed = JSON.parse(body) as typeof parsed
  } catch {
    const peek = body.slice(0, PEEK).replace(/\s+/g, ' ').trim()
    return {
      ok: false,
      error: `This response is not JSON, so there is nothing to filter${peek ? ` (it starts “${peek}…”)` : ''}.`,
    }
  }

  let result: unknown
  try {
    result = JSONPath({ path, json: parsed, eval: 'safe', wrap: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `That is not a valid JSONPath: ${message}` }
  }

  // `wrap: true` makes the result always an array, so the match COUNT is honest — without it a
  // single hit and a one-element array are indistinguishable, and "1 match" would be a guess.
  const matches = Array.isArray(result) ? result.length : 0
  if (matches === 0) return { ok: true, content: '', matches: 0 }

  // A single match unwraps: `$.data.token` should read as the token, not as a one-item array
  // containing it. Several matches stay a list, because that is what they are.
  const value = matches === 1 ? (result as unknown[])[0] : result
  return { ok: true, content: JSON.stringify(value, null, 2), matches }
}
