// The MODEL-FACING CONTRACT of `browser`: the flat Zod schema (per-action params as
// optional siblings — no nested unions, so the mirror stays provider-compatible), the tool
// description, and the input tolerances the schema cannot express (ref normalization, action
// inference from the call's own fields, required-field guards).
//
// What the schema declares is exactly what execute accepts: interactions exist only as steps.
// The rewrites and the one named refusal that run before validation live in
// `browser-lift.ts`.
//
// Kept apart from the tool body (browser.ts) because it changes for its
// own reason: every lesson about how models MISUSE the tool lands here as a
// tolerance or a fix-it message, never in the relay flow.

import { z } from 'zod'
import { rewriteBrowserArguments } from './browser-lift'

import { ACTIONS, STEP_ACTIONS, TAKE_SCREENSHOT, type BrowserAction } from './browser-actions'
export { type BrowserAction, TAKE_SCREENSHOT } from './browser-actions'
export { buildPreviewCommand, missingFieldMessage, normalizeRef } from './browser-input-command'

const stepSchema = z
  .object({
    action: z.enum(STEP_ACTIONS),
    ref: z.string().optional(),
    selector: z.string().optional(),
    text: z.string().optional().describe('type: the text. select: option value or label.'),
    key: z.string().optional(),
    keys: z.array(z.string()).optional(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    amount: z.number().optional(),
    expression: z.string().optional(),
    gone: z.boolean().optional().describe('wait: until text/selector is gone.'),
    timeout_ms: z.number().optional().describe('wait: limit, default 10000, max 15000.'),
    // Models put this on a step at least as often as on the call; it means the same thing.
    snapshot_after: z.boolean().optional().describe('Same as the call-level flag.'),
  })
  .strict()

/**
 * What the MODEL is shown, and all the tool takes. Single interactions are not top-level
 * actions: every click/type/press/scroll/hover goes through `steps`, so the schema carries the
 * interaction vocabulary ONCE (in the step shape) instead of twice — the largest single saving
 * in the whole tool roster (~1,900 → <900 tokens per request).
 */
export const advertisedObject = z.object({
  preview_id: z.string().min(1).optional().describe('Browser tab ID.'),
  preview_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe('close: tab IDs.'),
  background: z.boolean().optional().describe('open: keep hidden.'),
  viewport: z
    .object({
      width: z.number().int().min(240).max(3840),
      height: z.number().int().min(240).max(3840),
    })
    .strict()
    .nullable()
    .optional()
    .describe('A fixed size; null resets.'),
  action: z
    .enum(ACTIONS)
    // Optional so an unambiguous call missing `action` (e.g. only `expression`) is
    // INFERRED at execute time instead of hard-rejected (a wasted round-trip). Set it
    // explicitly — inference only covers the single-signal cases.
    .optional(),
  url: z.string().optional().describe("open: page URL, or mini-app:<name> for a mini app's view."),
  file_path: z
    .string()
    .optional()
    .describe('open: local file; serves its folder with assets. No server needed.'),
  ref: z.string().optional().describe('take_screenshot: snapshot ref.'),
  snapshot_after: z.boolean().optional().describe('steps/evaluate: include fresh tree.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('read: start character; the reply says the next one.'),
  steps: z
    .array(stepSchema)
    .optional()
    .describe(
      'Ordered actions by ref or selector; stop on error. select: a dropdown option (listed in the snapshot) by value or label. wait: text or selector to appear, for late content. End with snapshot to observe.',
    ),
  expression: z
    .string()
    .optional()
    .describe('evaluate: page JS expression; returns the awaited value.'),
  goal: z.string().optional().describe('goal: the sub-goal.'),
  values: z.array(z.string()).max(20).optional().describe('goal: texts to type.'),
  history_operation: z.enum(['list', 'search', 'open', 'remove', 'clear']).optional(),
  history_query: z.string().max(200).optional().describe('history search: text.'),
  history_urls: z
    .array(z.string().url())
    .min(1)
    .max(100)
    .optional()
    .describe('history remove: exact URLs.'),
})

const advertisedSchema = refineBrowserInput(advertisedObject)

/**
 * The contract for a model that cannot read images: the same object minus `take_screenshot` and
 * its `ref` target. Offering a picture to a text-only model spends a call on an image the
 * provider will not show it, so the action is not advertised at all (`forModel` in browser.ts).
 */
export const textOnlyObject = advertisedObject.omit({ ref: true }).extend({
  action: z
    .enum(
      ACTIONS.filter((action) => action !== TAKE_SCREENSHOT) as [BrowserAction, ...BrowserAction[]],
    )
    .optional(),
})

export function refineBrowserInput<T extends z.ZodObject>(object: T) {
  return object.strict().superRefine((raw, ctx) => {
    const input = raw as BrowserInput
    const action = inferAction(input)
    if (input.preview_ids && action !== 'close')
      ctx.addIssue({
        code: 'custom',
        path: ['preview_ids'],
        message: 'preview_ids is only for close.',
      })
    if (input.preview_ids && input.preview_id)
      ctx.addIssue({
        code: 'custom',
        path: ['preview_ids'],
        message: 'Use preview_ids or preview_id, not both.',
      })
    if (action === 'history' && (input.preview_id || input.preview_ids))
      ctx.addIssue({
        code: 'custom',
        path: ['preview_id'],
        message: 'History is app-wide, not tab-scoped.',
      })
    if (input.viewport !== undefined && action !== 'open' && action !== 'viewport')
      ctx.addIssue({
        code: 'custom',
        path: ['viewport'],
        message: 'Use action="viewport" or "open" to set dimensions.',
      })
    if (input.values !== undefined && action !== 'goal')
      ctx.addIssue({
        code: 'custom',
        path: ['values'],
        message: 'values is only for goal.',
      })
    if (input.offset !== undefined && action !== 'read')
      ctx.addIssue({
        code: 'custom',
        path: ['offset'],
        message: 'offset is only for read.',
      })
    if (input.background !== undefined && action !== 'open')
      ctx.addIssue({
        code: 'custom',
        path: ['background'],
        message: 'background is supported only for open.',
      })
  })
}

// The rewrites run BEFORE validation, so the rest of the tool sees one contract
// (`browser-lift.ts` explains what each recognises and why a refusal costs more than
// the call it refuses).
export const browserInputSchema = z.preprocess(rewriteBrowserArguments, advertisedSchema)

/** {@link browserInputSchema} for a model that cannot read images. */
export const textOnlyBrowserInputSchema = z.preprocess(
  rewriteBrowserArguments,
  refineBrowserInput(textOnlyObject),
)

export { prepareBrowserArguments } from './browser-lift'

export type BrowserInput = z.infer<typeof advertisedObject>

/** The input once an action is known (explicit or inferred). */
export type ResolvedInput = BrowserInput & {
  action: NonNullable<BrowserInput['action']>
}

/**
 * Infer the intended `action` when a call omits it but its payload unambiguously
 * names exactly one action's signature field. Order matters (most specific first);
 * returns undefined when the intent is ambiguous so the caller reports a fix-it.
 * A bare `ref` names nothing: it is take_screenshot's target and a step's, never a click.
 */
export function inferAction(input: BrowserInput): BrowserInput['action'] {
  if (input.action) return input.action
  if (input.expression != null) return 'evaluate'
  if (input.goal != null) return 'goal'
  if (input.steps?.length) return 'steps'
  if (input.file_path != null || input.url != null) return 'open'
  if (input.viewport !== undefined) return 'viewport'
  return undefined
}

export const MISSING_ACTION_MESSAGE =
  'browser needs an "action" (one of: open, close, viewport, snapshot, read, take_screenshot, console, evaluate, back, forward, reload, steps, goal, history — interactions go inside steps, e.g. {"action":"steps","steps":[{"action":"click","ref":"e3"}]}). Set it explicitly.'

/**
 * The verification DISCIPLINE (what counts as evidence, background for delegated work, never
 * retry blindly) is the prompt's, stated once in "# Execution discipline" for every run that
 * holds this tool. This says how the tool behaves.
 */
export const BROWSER_DESCRIPTION =
  'Drive Browser tabs in the desktop app (relay-only); reuse preview_id from open or Browser context. Multi-step page work (a form, a search, a date picker): prefer goal — a decision model clicks and types only your values toward it; then verify the page it returns. steps: single precise actions. Local files: open file_path. Set viewport only to check a width; null resets. history: shared visits. read: top-document text in windows; back, forward, reload move the tab. Errors and auto-dismissed dialogs during an action are attached; a reload invalidates refs: re-snapshot. Same-origin frames: snapshot, steps only. Credentials: type text ${secret:KEY} (a Vault key) in a type step; the host fills it in and you never see it. Nowhere else.'
