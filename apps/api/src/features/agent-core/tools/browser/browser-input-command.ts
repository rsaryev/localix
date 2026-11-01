// The required-field guards and the relay command of `browser`: what one call is missing, in the
// words its own action would use, and the probe command built from a validated call. The model-
// facing schema and description stay in `browser-input.ts`, which re-exports everything here.

import type { PreviewAction, PreviewCommand } from '../preview/preview-control'
import { TAKE_SCREENSHOT } from './browser-actions'
import type { BrowserInput, ResolvedInput } from './browser-input'

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

type Step = NonNullable<BrowserInput['steps']>[number]

/** What one step is missing, in the words its own action would use; null when complete. */
function missingStepField(step: Step): string | null {
  if (
    (step.action === 'click' || step.action === 'select' || step.action === 'hover') &&
    !normalizeRef(step.ref) &&
    !step.selector
  )
    return `a "${step.action}" step needs a target: a "ref" from the latest snapshot (e.g. "e3") or a CSS "selector". Take a snapshot first.`
  // `press`/`scroll` may legitimately target the page (no ref/selector), and `type` the field that
  // has focus (a click before it may have opened a dialog with its own field).
  if (step.action === 'type' && step.text == null)
    return 'a "type" step needs "text": what to type into its target, or into the focused field.'
  if (step.action === 'press' && !step.key && !step.keys?.length)
    return 'a "press" step needs a "key" (e.g. "Enter") or "keys" (e.g. ["ArrowUp","ArrowRight"]).'
  if (step.action === 'select' && step.text == null)
    return 'a "select" step needs "text": the option\'s value or visible label, as the snapshot lists them.'
  if (step.action === 'wait') {
    if (!step.text && !step.selector)
      return 'a "wait" step needs "text" or a CSS "selector" to wait for (gone:true waits for it to disappear).'
    if (step.text && step.selector) return 'a "wait" step takes "text" or "selector", not both.'
  }
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
  if (input.action === 'goal' && !input.goal?.trim())
    return 'action="goal" needs a "goal": a short sub-goal on this tab, e.g. "search flights from Zurich to London"; put every text it may type in "values".'
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
  const snapshotAfter =
    input.action === 'evaluate'
      ? false
      : (input.snapshot_after ?? false) || Boolean(input.steps?.some((step) => step.snapshot_after))
  const ref = normalizeRef(input.ref)
  return {
    // The one seam between the tool vocabulary and the probe protocol (see TAKE_SCREENSHOT).
    action: (input.action === TAKE_SCREENSHOT ? 'screenshot' : input.action) as PreviewAction,
    ...(input.preview_id ? { previewId: input.preview_id } : {}),
    ...(input.viewport !== undefined ? { viewport: input.viewport } : {}),
    ...(ref ? { ref } : {}),
    ...(snapshotAfter ? { snapshotAfter: true } : {}),
    ...(input.steps?.length
      ? {
          steps: input.steps.map(({ snapshot_after: _batch, timeout_ms, ...s }) => ({
            ...s,
            ref: normalizeRef(s.ref),
            ...(timeout_ms !== undefined ? { timeoutMs: timeout_ms } : {}),
          })),
        }
      : {}),
    ...(input.expression != null ? { expression: input.expression } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
    ...(input.history_operation ? { historyOperation: input.history_operation } : {}),
    ...(input.history_query ? { historyQuery: input.history_query } : {}),
    ...(input.history_urls ? { historyUrls: input.history_urls } : {}),
  }
}
