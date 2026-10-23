import { zValidator as honoZodValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { ZodType } from 'zod'
import { summarizeZodIssues } from '@localixai/mini-app-sdk/backend'
import { jsonError } from './http'

/**
 * `zValidator` with the app's error envelope — import THIS, never `@hono/zod-validator` directly.
 *
 * WHY THIS FILE EXISTS. `zValidator` does not throw on a schema failure, so it never reaches
 * `createRootErrorHandler` — the handler documented as the one that "must answer EVERYTHING".
 * Without a hook, `@hono/zod-validator@0.9.0` does `if (!result.success) return c.json(result, 400)`:
 * the raw safeParse result, `{success:false, error:{name:'ZodError', message:'<json dump>'}}`.
 *
 * That body is outside the `{ error: { code, message } }` contract every other failure follows, and
 * the consequence was user-visible rather than cosmetic. `apps/ui/src/shared/api/internal.ts`
 * `unwrap()` reads `error.error.message`, which on that body is the JSON dump of the Zod issue array.
 * Measured against the real projects router: creating a project with an empty name surfaced a
 * 24-line JSON blob as the error message, with `code` null — so no code-based handling could work
 * either.
 *
 * Keeping the drop-in NAME `zValidator` is deliberate: the fix is then one import line per router
 * instead of an edit at every one of the ~250 call sites, and a call site cannot be half-migrated.
 * `validator-hook.test.ts` enforces that no other file imports the raw validator, because a bare
 * call compiles, serves traffic, and misbehaves only on malformed input — invisible at review.
 *
 * Status stays 400 (what these endpoints already answered); only the BODY changes. The code becomes
 * `validation_error`, which `CLIENT_FAULT_CODES` in `http.ts` already names.
 */
export function zValidator<Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) {
  return honoZodValidator(target, schema, (result, c) => {
    if (result.success) return
    // The formatting rule is shared with `defaultErrorHandler` and the plugin validators —
    // see `summarizeZodIssues`. This envelope has no `detail` slot, so it takes `message`,
    // which folds the other failed field names in rather than losing them.
    return jsonError(c, 400, 'validation_error', summarizeZodIssues(result.error).message)
  })
}
