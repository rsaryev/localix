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
import type { PreviewAction, PreviewCommand } from '../preview/preview-control'
import { rewriteBrowserArguments } from './browser-lift'

import { ACTIONS, STEP_ACTIONS, TAKE_SCREENSHOT, type BrowserAction } from './browser-actions'
export { type BrowserAction, TAKE_SCREENSHOT } from './browser-actions'

/**
 * Normalize a ref to the bare `eN` handle the probe expects. The snapshot tree
 * prints handles as `[ref=eN]`, so models copy them in many forms — `"[e3]"`,
 * `"ref=e3"`, `"[ref=e3]"`, `"#e3"`, with stray whitespace. All of these used to
 * fail with `ref "[e3]" not found` even though the element existed.
 * Strip the wrapping and keep the `eN` token; leave anything without one untouched
 * so a genuinely different ref still reaches the probe (and errors honestly).
 */
export function normalizeRef(ref: string | undefined): string | undefined {
  if (ref == null) return ref
  const m = ref.match(/e\d+/i)
  return m ? m[0].toLowerCase() : ref.trim()
}

const stepSchema = z
  .object({
    action: z.enum(STEP_ACTIONS),
    ref: z.string().optional(),
    selector: z.string().optional(),
    text: z.string().optional(),
    key: z.string().optional(),
    keys: z.array(z.string()).optional(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
    amount: z.number().optional(),
    expression: z.string().optional(),
  })
  .strict()

/**
 * What the MODEL is shown, and all the tool takes. Single interactions are not top-level
 * actions: every click/type/press/scroll/hover goes through `steps`, so the schema carries the
 * interaction vocabulary ONCE (in the step shape) instead of twice — the largest single saving
 * in the whole tool roster (~1,900 → <900 tokens per request).
 */
const advertisedObject = z.object({
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
    .describe('open/viewport: CSS size; null fills the panel.'),
  action: z
    .enum(ACTIONS)
    // Optional so an unambiguous call missing `action` (e.g. only `expression`) is
    // INFERRED at execute time instead of hard-rejected (a wasted round-trip). Set it
    // explicitly — inference only covers the single-signal cases.
    .optional()
    .describe('open/close/viewport/snapshot/steps/take_screenshot/console/evaluate/history.'),
  url: z.string().optional().describe("open: page URL, or plugin:<name> for a plugin's view."),
  file_path: z.string().optional().describe('open: serve a static file.'),
  start_command: z.string().optional().describe('open: server relaunch command.'),
  ref: z.string().optional().describe('take_screenshot: snapshot ref.'),
  snapshot_after: z.boolean().optional().describe('steps/evaluate: include fresh tree.'),
  steps: z
    .array(stepSchema)
    .optional()
    .describe('Ordered actions by ref or selector; stop on error. End with snapshot to observe.'),
  expression: z
    .string()
    .optional()
    .describe('evaluate: page JS expression; returns the awaited value.'),
  history_operation: z
    .enum(['list', 'search', 'open', 'remove', 'clear'])
    .optional()
    .describe('history: list/search/open/remove/clear.'),
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
const textOnlyObject = advertisedObject.omit({ ref: true }).extend({
  action: z
    .enum(
      ACTIONS.filter((action) => action !== TAKE_SCREENSHOT) as [BrowserAction, ...BrowserAction[]],
    )
    .optional()
    .describe('open/close/viewport/snapshot/steps/console/evaluate/history.'),
})

function refineBrowserInput<T extends z.ZodObject>(object: T) {
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

export {
  liftTrailingScreenshot,
  prepareBrowserArguments,
  retiredInteractionMessage,
} from './browser-lift'

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
  if (input.steps?.length) return 'steps'
  if (input.file_path != null || input.url != null) return 'open'
  if (input.viewport !== undefined) return 'viewport'
  return undefined
}

export const MISSING_ACTION_MESSAGE =
  'browser needs an "action" (one of: open, close, viewport, snapshot, take_screenshot, console, evaluate, steps, history — interactions go inside steps, e.g. {"action":"steps","steps":[{"action":"click","ref":"e3"}]}). Set it explicitly.'

type Step = NonNullable<BrowserInput['steps']>[number]

/** What one step is missing, in the words its own action would use; null when complete. */
function missingStepField(step: Step): string | null {
  if (
    (step.action === 'click' || step.action === 'type' || step.action === 'hover') &&
    !normalizeRef(step.ref) &&
    !step.selector
  )
    return `a "${step.action}" step needs a target: a "ref" from the latest snapshot (e.g. "e3") or a CSS "selector". Take a snapshot first.`
  // `press`/`scroll` may legitimately target the page (no ref/selector).
  if (step.action === 'press' && !step.key && !step.keys?.length)
    return 'a "press" step needs a "key" (e.g. "Enter") or "keys" (e.g. ["ArrowUp","ArrowRight"]).'
  if (step.action === 'evaluate' && !step.expression?.trim())
    return 'an "evaluate" step needs an "expression" — a JS expression to run in the page.'
  return null
}

/**
 * Required-field guards the flat schema cannot express (each action and each step has its own
 * signature). Returns a fix-it message, or null when the call is well-formed — failing fast
 * here beats a vague probe error a turn later, and a batch is checked whole before any of it
 * runs, so a half-applied batch never has to be reasoned about.
 */
export function missingFieldMessage(input: ResolvedInput): string | null {
  if (input.action === 'history') {
    if (!input.history_operation)
      return 'history needs history_operation: list, search, open, remove, or clear.'
    if (input.history_operation === 'search' && !input.history_query?.trim())
      return 'history search needs history_query.'
    if (input.history_operation === 'remove' && !input.history_urls?.length)
      return 'history remove needs history_urls with exact URLs.'
  }
  if (input.action === 'viewport' && input.viewport === undefined)
    return 'viewport requires dimensions or null to fill the panel.'
  if (input.action === 'evaluate' && !input.expression?.trim()) {
    return 'action="evaluate" needs an "expression" — a JS expression to run in the page, e.g. "window.score" or "document.querySelector(\'#board\').textContent".'
  }
  if (input.action === 'steps' && !input.steps?.length)
    return 'action="steps" needs a non-empty "steps" array, e.g. [{"action":"click","ref":"e3"}].'
  for (const [index, step] of (input.steps ?? []).entries()) {
    const missing = missingStepField(step)
    if (missing) return `steps[${index}]: ${missing}`
  }
  return null
}

/**
 * The relay command for an action. `snapshotAfter` defaults OFF: a batch returns a
 * CHEAP change-diff ("what changed" vs the prior snapshot) — enough to confirm the
 * effect (incl. a theme flip, now that the diff detects html/body attribute + color
 * changes) at a fraction of the tokens of re-dumping the whole tree after every click
 * (the re-snapshot churn). Pass snapshot_after:true to fold the FULL fresh tree in when
 * you need new [ref=eN] handles to act next; or call action="snapshot" explicitly. For
 * "evaluate" it is never folded in here (the tool takes the follow-up snapshot itself,
 * only when asked).
 */
export function buildPreviewCommand(input: ResolvedInput): PreviewCommand {
  const snapshotAfter = input.action === 'evaluate' ? false : (input.snapshot_after ?? false)
  const ref = normalizeRef(input.ref)
  return {
    // The one seam between the tool vocabulary and the probe protocol (see TAKE_SCREENSHOT).
    action: (input.action === TAKE_SCREENSHOT ? 'screenshot' : input.action) as PreviewAction,
    ...(input.preview_id ? { previewId: input.preview_id } : {}),
    ...(input.viewport !== undefined ? { viewport: input.viewport } : {}),
    ...(ref ? { ref } : {}),
    ...(snapshotAfter ? { snapshotAfter: true } : {}),
    ...(input.steps?.length
      ? { steps: input.steps.map((s) => ({ ...s, ref: normalizeRef(s.ref) })) }
      : {}),
    ...(input.expression != null ? { expression: input.expression } : {}),
    ...(input.history_operation ? { historyOperation: input.history_operation } : {}),
    ...(input.history_query ? { historyQuery: input.history_query } : {}),
    ...(input.history_urls ? { historyUrls: input.history_urls } : {}),
  }
}

/**
 * The verification DISCIPLINE (what counts as evidence, background for delegated work, never
 * retry blindly) is the prompt's, stated once in "# Execution discipline" for every run that
 * holds this tool. This says how the tool behaves.
 */
export const BROWSER_DESCRIPTION =
  'Drive local and remote Browser tabs in the connected desktop app; relay-only. Reuse preview_id from open or Browser context. history reads or manages shared visits without a tab ID. Local sites support visual feedback. Errors and auto-dismissed dialogs during an action are attached. Reload invalidates refs: re-snapshot. Reopen file_path after editing.'
