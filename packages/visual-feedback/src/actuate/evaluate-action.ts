/**
 * The `evaluate` action: run a JS expression in the page after the page settles. Split out of
 * actuate/index.ts so the dispatcher stays a router.
 */

import type { VfCommand } from '../protocol/index'
import type { ActuateDeps, ActuateResult } from './types'
import { settleTransitions } from './settle'
import { fail } from './target'
import { serializeEvalResult, compileEvalExpression } from './evaluate'

export async function performEvaluateAction(
  cmd: VfCommand,
  deps: ActuateDeps,
): Promise<ActuateResult> {
  const expr = cmd.expression
  if (expr == null || expr.trim() === '')
    return fail(
      'bad_request',
      '`evaluate` requires an `expression` (a JS expression run in the page).',
    )
  // Settle BEFORE reading. A prior action (or an earlier step of a `steps` batch) may
  // have queued an ASYNC framework commit — React's setState→useEffect flips
  // `data-theme` only a microtask + 2 rAF after the click. Reading synchronously
  // would return the OLD value, so a post-click `evaluate` gaslights the model into
  // thinking a WORKING toggle is broken. Settling first (the same
  // injectable 2-rAF settle the click action + snapshot baseline use) flushes the
  // commit so the read reflects it. NB: this cannot rescue a SINGLE expression that
  // both mutates and reads (e.g. `toggleTheme(); getAttr()` — the async commit is
  // queued DURING the expression, after this settle); steer that to the `steps` path
  // (click step settles, then an evaluate step reads) — see the tool docstring.
  const settle = deps.settle ?? settleTransitions
  await settle()
  let raw: unknown
  try {
    raw = await compileEvalExpression(expr)()
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return fail('failed', `evaluate threw — ${msg}`)
  }
  return { ok: true, result: { action: 'evaluate', value: serializeEvalResult(raw) } }
}
