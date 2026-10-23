/**
 * A plugin router's request validator — one definition, one choice per plugin: its envelope.
 *
 * WHY THIS EXISTS. `@hono/zod-validator` does not throw on a schema failure, so a failure never
 * reaches the router's `onError`; without a hook it answers the raw safeParse result, a JSON dump
 * of the Zod issue array that a UI renders as the error message (or, where the client reads
 * `error` as a string, as `[object Object]`). Every bundled plugin had fixed that the same way —
 * a `validated()` wrapper installing a hook around `summarizeZodIssues` — and there were eleven
 * copies of it across ten routers, differing only in which of three envelopes they answered in.
 * Eleven copies of one rule drift the way any copies do; learning and external-agents had already
 * drifted into sending the summary OBJECT, which their clients showed as `[object Object]`.
 *
 * So the rule lives here and a plugin states only what genuinely differs — the envelope its client
 * reads:
 *
 *  - `nested` (default): {@link jsonError}'s `{ error: { code, message, detail } }`, which the SDK
 *    client (`unwrapMiniAppResponse`) reads;
 *  - `flat`: `{ error, code, detail }`, the typed-error body of the workbench plugins whose
 *    clients read `error` as the sentence and branch on `code`;
 *  - `text`: `{ error }` — a bare sentence, for clients that read nothing else.
 *
 * Built on `hono/validator` rather than `@hono/zod-validator`, with the same input/output typing
 * (so a typed `hc` client keeps its request types) and the same async parse, and without adding
 * a dependency every plugin a person builds would have to resolve.
 */
import type { Env, MiddlewareHandler, ValidationTargets } from 'hono'
import { validator, type InferInput } from 'hono/validator'
import { safeParseAsync, type $ZodType, type input, type output } from 'zod/v4/core'
import { jsonError, summarizeZodIssues } from './http'

export type RouteValidationTarget = 'json' | 'query' | 'param'

export interface RouteValidatorOptions {
  /** Which body a rejected request gets — see the module comment. Default `nested`. */
  envelope?: 'nested' | 'flat' | 'text'
  /** The machine code in `nested`/`flat` bodies. Default `invalid_request`. */
  code?: string
}

type HasUndefined<T> = undefined extends T ? true : false

/** The request shape a validated route declares — mirrors `@hono/zod-validator`'s. */
export type RouteValidatorInput<Target extends RouteValidationTarget, In, Out> = {
  in: HasUndefined<In> extends true
    ? { [K in Target]?: [In] extends [ValidationTargets[K]] ? In : InferInput<In, K> }
    : { [K in Target]: [In] extends [ValidationTargets[K]] ? In : InferInput<In, K> }
  out: { [K in Target]: Out }
}

export type RouteValidator = <
  Target extends RouteValidationTarget,
  Schema extends $ZodType,
  E extends Env = Env,
  P extends string = string,
>(
  target: Target,
  schema: Schema,
) => MiddlewareHandler<E, P, RouteValidatorInput<Target, input<Schema>, output<Schema>>>

/**
 * Build a plugin's validator once: `const validated = routeValidator({ envelope: 'flat' })`, then
 * `validated('json', schema)` on each route and `c.req.valid('json')` in the handler.
 */
export function routeValidator(options: RouteValidatorOptions = {}): RouteValidator {
  const envelope = options.envelope ?? 'nested'
  const code = options.code ?? 'invalid_request'
  return ((target: RouteValidationTarget, schema: $ZodType) =>
    validator(target, async (value, context) => {
      const result = await safeParseAsync(schema, value)
      if (result.success) return result.data
      const summary = summarizeZodIssues(result.error)
      if (envelope === 'text') return context.json({ error: summary.message }, 400)
      if (envelope === 'flat') {
        return context.json({ error: summary.headline, code, detail: summary.detail }, 400)
      }
      return jsonError(context, 400, code, summary.headline, summary.detail)
    })) as RouteValidator
}
