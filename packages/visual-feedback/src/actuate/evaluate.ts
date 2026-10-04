/**
 * `evaluate` action support — run an arbitrary JS expression in the PAGE realm and
 * serialize the result to a compact, model-readable, length-capped string. Split out
 * of actuate/index.ts as a leaf (like input/diff/console-capture) so the dispatcher
 * stays a thin router and the serializer is unit-testable in isolation.
 */

/** Cap a serialized evaluate result so a careless expression can't flood the model. */
export const MAX_EVAL_CHARS = 16_384

/**
 * Serialize an `evaluate` result to a compact, model-readable string. Strings pass
 * through; DOM nodes become a tag + trimmed text (a raw element JSON-stringifies to
 * `{}`, useless); everything else is JSON (circular refs / unstringifiable values
 * fall back to a placeholder). Always length-capped.
 */
export function serializeEvalResult(v: unknown): string {
  const cap = (s: string): string =>
    s.length > MAX_EVAL_CHARS ? `${s.slice(0, MAX_EVAL_CHARS)}… [truncated, ${s.length} chars]` : s
  if (v === undefined) return 'undefined'
  if (v === null) return 'null'
  if (typeof v === 'string') return cap(v)
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (typeof v === 'symbol') return cap(v.toString())
  if (typeof v === 'function')
    return cap(`[function ${(v as { name?: string }).name || 'anonymous'}]`)
  if (typeof Element !== 'undefined' && v instanceof Element) {
    const text = (v.textContent ?? '').trim().replace(/\s+/g, ' ')
    return cap(`<${v.tagName.toLowerCase()}> ${text}`)
  }
  if (typeof NodeList !== 'undefined' && (v instanceof NodeList || v instanceof HTMLCollection)) {
    return cap(
      Array.from(v as ArrayLike<Node>)
        .map((n) => serializeEvalResult(n))
        .join('\n'),
    )
  }
  try {
    const seen = new WeakSet<object>()
    const json = JSON.stringify(
      v,
      (_k, val) => {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]'
          seen.add(val)
        }
        if (typeof val === 'bigint') return String(val)
        return val
      },
      2,
    )
    return cap(json ?? '[unserializable]')
  } catch {
    return cap('[unserializable]')
  }
}

/**
 * Compile an evaluate expression into a callable, with COMPLETION-VALUE semantics so
 * a multi-statement snippet returns the value of its last statement (like the
 * DevTools console), not `undefined`.
 *
 * Three tiers, chosen so nothing runs twice (each fallback triggers only on a
 * SyntaxError, i.e. a PARSE failure where no code executed):
 *  1. EXPRESSION — `return (expr)`. Handles a single expression and supports
 *     top-level `await`; page globals resolve (AsyncFunction runs in global scope).
 *  2. MULTI-STATEMENT — on a construction SyntaxError, run via direct `eval`, which
 *     yields the last statement's COMPLETION VALUE (fixes `toggleTheme();
 *     getAttr()` → the getAttr result instead of `undefined`, the old bug).
 *     Direct eval keeps page-global scope. LIMITATION: eval'd code can't use
 *     top-level `await` — a snippet needing both multiple statements AND await falls
 *     to tier 3 and returns `undefined`; restructure it into a single expression.
 *  3. STATEMENT BODY — if `eval` itself SyntaxErrors (the model wrote its own
 *     top-level `return`, illegal in eval), run the source as an async function body
 *     (where `return`/`await` are legal). No completion value without an explicit
 *     `return`.
 *
 * A strict page CSP without 'unsafe-eval' makes the constructor (and eval) throw —
 * surfaced as a clear, actionable error by the caller. A genuine RUNTIME throw from
 * the evaluated code is re-thrown (never swallowed to `undefined`) so the caller can
 * report `evaluate threw: …`.
 */
export function compileEvalExpression(expr: string): () => Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
    ...args: string[]
  ) => (...a: unknown[]) => Promise<unknown>
  // Tier 1: single expression (+ await). SyntaxError is caught at CONSTRUCTION, so
  // nothing has executed — safe to fall through to the multi-statement runner.
  try {
    return new AsyncFunction(`return (${expr}\n)`) as () => Promise<unknown>
  } catch (syntax) {
    if (!(syntax instanceof SyntaxError)) throw syntax
  }
  // Tiers 2 + 3 (decided at CALL time by whether eval can parse the source).
  const evalCompletion = new AsyncFunction('return eval(arguments[0])')
  const statementBody = () => new AsyncFunction(expr)()
  return async () => {
    try {
      return await evalCompletion(expr)
    } catch (err) {
      // A SyntaxError from eval means it could not PARSE the source (nothing ran) —
      // e.g. a top-level `return`. Re-run as a function body, where that is legal.
      if (err instanceof SyntaxError) return await statementBody()
      throw err // genuine runtime throw — surface it, never coerce to undefined
    }
  }
}
