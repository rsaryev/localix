/**
 * The MODEL-FACING CONTRACT of `api_client` — the mini app's ONE tool.
 *
 * It was two: `http_request` and `manage_environment`, split by subject the way trading splits
 * `market_data` from `manage_chart`. That split had a real argument behind it — "a fourteen-action
 * enum is a tool whose description nobody reads to the end" — and merging by concatenating the two
 * enums would have proved it right.
 *
 * So the merge is not a concatenation. Requests and environments answer to the SAME verbs (list,
 * get, save, delete), so the second axis is the SUBJECT, not more verbs:
 *
 *     action: send | list | get | save | delete | use | import | export | batch
 *     target: request | environment                                          (2, default request)
 *
 * Eight domain verbs, one batch envelope, and one two-valued switch instead of twelve names to
 * keep apart. It reads as one
 * sentence — "list environments", "save request" — and the pairs that mean nothing (`send` an
 * environment, `import` one) are refused by {@link apiToolProblem} with a message that says what
 * to do instead, rather than being unrepresentable and therefore undiscoverable.
 *
 * The shape follows this mini app's established pattern, unchanged:
 *   1. ONE flat `z.object` with an `action` enum and per-action params as OPTIONAL siblings.
 *   2. Every `.describe()` says WHICH action needs the field and shows a literal example.
 */

import type { z as Zod } from 'zod'
import { requestFields } from './http-request-schema'

export const API_OPERATION_ACTIONS = [
  'send',
  'list',
  'get',
  'save',
  'delete',
  'use',
  'import',
  'export',
] as const

export const API_ACTIONS = [...API_OPERATION_ACTIONS, 'batch'] as const

export const API_TARGETS = ['request', 'environment'] as const

export type ApiAction = (typeof API_ACTIONS)[number]
export type ApiOperationAction = (typeof API_OPERATION_ACTIONS)[number]
export type ApiTarget = (typeof API_TARGETS)[number]

export type ApiOperationInput = Record<string, unknown> & {
  action: ApiOperationAction
  target?: ApiTarget
}

/** Verbs that only make sense for a saved REQUEST. */
const REQUEST_ONLY: ReadonlySet<ApiAction> = new Set<ApiAction>(['send', 'import', 'export'])

/** Verbs that only make sense for an ENVIRONMENT. */
const ENVIRONMENT_ONLY: ReadonlySet<ApiAction> = new Set<ApiAction>(['use'])

/**
 * The pair this call names, with `target` defaulted. One place decides the default, so the
 * validator, the classifier and the body can never disagree about what an omitted target meant.
 */
export function resolveTarget(input: { target?: string }): ApiTarget {
  return input.target === 'environment' ? 'environment' : 'request'
}

/** Why this action/target pair cannot be served, or null. */
export function targetProblem(action: ApiAction, target: ApiTarget): string | null {
  if (target === 'environment' && REQUEST_ONLY.has(action)) {
    return (
      `action="${action}" applies to a saved request, not an environment. ` +
      'Drop "target", or use one of list/get/save/delete/use for environments.'
    )
  }
  if (target === 'request' && ENVIRONMENT_ONLY.has(action)) {
    return (
      'action="use" activates an ENVIRONMENT, e.g. {"action":"use","target":"environment","name":"staging"}. ' +
      'To send a saved request use {"action":"send","name":"…"}.'
    )
  }
  return null
}

export function buildApiToolSchema(z: typeof Zod) {
  const environmentVariable = z.object({
    name: z.string().describe('Variable name, referenced as `{{ base_url }}`, e.g. `base_url`.'),
    value: z
      .string()
      .describe(
        'Its value, e.g. `https://staging.api.dev`, or an existing `${secret:KEY}` vault reference.',
      ),
    disabled: z.boolean().optional().describe('Set true to keep the variable but not apply it.'),
    secret: z
      .boolean()
      .optional()
      .describe(
        'Set true for a credential. A literal value is moved into the native Vault before the environment file is written.',
      ),
  })

  const target = z
    .enum(API_TARGETS)
    .optional()
    .describe(
      'What the operation applies to. Omit for a saved request (the default); pass ' +
        '"environment" to manage environments.',
    )
  const name = z
    .string()
    .optional()
    .describe(
      'The saved request or environment name. A request name may carry folders, e.g. `users/list`. ' +
        'For send, a name re-sends the saved request; omit it for a one-off URL.',
    )
  const variables = environmentVariable
    .array()
    .optional()
    .describe(
      'For save with target="environment": the full replacement variable list. Mark credentials with `secret:true`.',
    )

  // A batch operation deliberately has the SAME flat shape as a single call. The model learns one
  // contract, then either sends it at the root or repeats it under `operations` — no second mini API
  // whose fields can drift from the first one.
  const operation = z.object({
    ...requestFields(z),
    action: z.enum(API_OPERATION_ACTIONS),
    target,
    name,
    variables,
  })

  // Every request field, verbatim from the one place that describes them — then this tool's own
  // action/target/name/variables plus the one-call batch envelope.
  return z.object({
    ...requestFields(z),
    action: z
      .enum(API_ACTIONS)
      .describe(
        'Choose from the user’s verb: call/test/check/fetch now = `send`; add/create/save for later = `save` (it does not send); ' +
          'when the task needs TWO OR MORE operations, use `batch` ONCE and put every save/send/etc. in `operations`; never make one tool call per request. ' +
          'REQUESTS (the default target): `send` performs one now; `save` stores one under `name` ' +
          'for reuse; `list` shows saved requests; `get` shows one; `delete` removes one; ' +
          '`import` turns a pasted cURL command, OpenAPI 3 spec, Postman/Insomnia export or HAR ' +
          'archive into saved requests; `export` writes them into the repo. ' +
          'ENVIRONMENTS (with target="environment"): `list`, `get`, `save`, `delete`, and `use` ' +
          'to make one active — its variables are what `{{placeholders}}` render against.',
      ),
    target,
    name,
    variables,
    operations: operation
      .array()
      .min(1)
      .max(12)
      .optional()
      .describe(
        'Required for action="batch": 1–12 ordered operations executed in this ONE tool call. ' +
          'Use it whenever creating, testing, reading, or deleting multiple requests. A save followed by a send of the same name stays ordered. ' +
          'The result combines status text and returns one deduplicated horizontal set of Open buttons.',
      ),
  })
}
