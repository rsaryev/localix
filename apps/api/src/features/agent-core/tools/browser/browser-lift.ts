/**
 * WHAT A MODEL MEANT, BEFORE THE SCHEMA JUDGES WHAT IT WROTE.
 *
 * The rewrites here turn a call into the shape the schema accepts, and they exist for one
 * reason: a refusal does not only lose one call, it teaches a model not to use the thing that
 * was refused. `browser` is the tool a member uses to LOOK at what it built, and a
 * member that stops batching pays a model round trip per click.
 *
 * Each corrects a mistake models make on the CURRENT schema, recorded in the incident its
 * comment names. None recovers a retired shape: the flat single interaction
 * (`action:"click", ref:"e3"`) is refused, by name, with the `steps` call that replaces it
 * (`retiredInteractionMessage`), because accepting it would keep a second contract alive that
 * the schema no longer shows.
 *
 * They run before validation, never after, so the rest of the tool sees one contract. None
 * invents an intention: each recognises a shape that has exactly one sensible reading and
 * leaves everything else untouched for the schema to refuse honestly.
 */

import { INTERACTIONS, TAKE_SCREENSHOT } from './browser-actions'

const INTERACTION_SET: ReadonlySet<string> = new Set(INTERACTIONS)

/** The step fields the flat contract carried at top level. `ref` is not one: screenshot owns it. */
const STEP_ONLY_FIELDS = ['selector', 'text', 'key', 'keys', 'direction', 'amount'] as const

/**
 * A FLAT INTERACTION IS REFUSED WITH THE CALL THAT REPLACES IT.
 *
 * The validator's own refusal of `action:"click"` reads "must be equal to one of the allowed
 * values" plus one "additional property" line per step field — true, and useless to a model
 * that has to guess the batch shape from it. So the message is built from the model's own
 * fields: the same interaction, moved into a one-step `steps` batch it can send next.
 */
export function retiredInteractionMessage(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const input = raw as Record<string, unknown>
  const flatAction = typeof input.action === 'string' && INTERACTION_SET.has(input.action)
  const stepFields = STEP_ONLY_FIELDS.filter((name) => input[name] !== undefined)
  // Without an action, step fields are the flat contract too (`{ref:"e3", text:"Ada"}` used to
  // be inferred as a type). With any other action they are a plain unknown field, which the
  // validator names well enough.
  if (!flatAction && (stepFields.length === 0 || input.action !== undefined)) return undefined
  const step: Record<string, unknown> = { action: flatAction ? input.action : impliedStep(input) }
  if (input.ref !== undefined) step.ref = input.ref
  for (const name of stepFields) step[name] = input[name]
  const example = JSON.stringify({ action: 'steps', steps: [step] })
  const what = flatAction
    ? `action="${String(input.action)}" is a step, not a top-level action`
    : `${stepFields.join(', ')} belong${stepFields.length === 1 ? 's' : ''} to a step, not to the call`
  return `browser: ${what}. Interactions go inside "steps", e.g. ${example}.`
}

/** The one interaction a set of step fields implies, for the example step only. */
function impliedStep(input: Record<string, unknown>): string {
  if (input.text !== undefined) return 'type'
  if (input.key !== undefined || input.keys !== undefined) return 'press'
  if (input.direction !== undefined || input.amount !== undefined) return 'scroll'
  return 'click'
}

/**
 * A BATCH THAT ENDS IN A SCREENSHOT keeps its steps and asks for the picture at the end.
 *
 * "Act, then look" is the natural batch, and models write it as
 * `steps:[{evaluate…},{take_screenshot}]`. The step vocabulary has no screenshot — for a real
 * reason, a batch result is text and cannot carry an image — so the call was REFUSED on a
 * schema error and both steps were lost. Recorded twice in one live turn, where the
 * member then went back to one round trip per action.
 *
 * So a trailing `take_screenshot` step becomes the call's own `take_screenshot` action, with the
 * steps before it carried in `steps`; the runner runs them first and photographs the result. Only
 * a TRAILING one — a screenshot in the middle would be an image the batch still cannot return,
 * and dropping it silently would be worse than the refusal this replaces.
 */
export function liftTrailingScreenshot(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const input = raw as Record<string, unknown>
  if (input.action !== 'steps' || !Array.isArray(input.steps) || input.steps.length < 2) return raw
  const steps = input.steps as Record<string, unknown>[]
  if (steps.at(-1)?.action !== TAKE_SCREENSHOT) return raw
  const body = steps.slice(0, -1)
  if (body.some((step) => step.action === TAKE_SCREENSHOT)) return raw
  return { ...input, action: TAKE_SCREENSHOT, steps: body }
}

/**
 * A PAGE URL WHERE THE PREVIEW ID BELONGS becomes that page's origin.
 *
 * Every preview id is an origin (`open-preview.ts`), and hosts compare it exactly. A model that
 * opened two files on one server naturally names them by their URLs; no host matched
 * "http://localhost:60831/index.html", so four commands in a row timed out as
 * host_unavailable. An http(s) URL has exactly one origin; anything else passes.
 */
function previewIdToOrigin(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const input = raw as Record<string, unknown>
  if (typeof input.preview_id !== 'string') return raw
  let origin: string
  try {
    const url = new URL(input.preview_id)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw
    origin = url.origin
  } catch {
    return raw
  }
  return origin === input.preview_id ? raw : { ...input, preview_id: origin }
}

/** The singular "step" for the batch — models reach for it naturally; it has one reading. */
const stepAlias = (raw: unknown): unknown =>
  raw && typeof raw === 'object' && (raw as { action?: unknown }).action === 'step'
    ? { ...(raw as object), action: 'steps' }
    : raw

/** Every rewrite, in order. Pure: it never refuses, so the zod schema can run it too. */
export function rewriteBrowserArguments(raw: unknown): unknown {
  return previewIdToOrigin(liftTrailingScreenshot(stepAlias(raw)))
}

/**
 * The runtime's pre-validation hook (`prepareArguments`). The runtime validates the JSON schema
 * and never parses zod, so without the hook the rewrites existed only in unit tests. A retired
 * flat interaction THROWS here: the runtime turns the message into the call's error result,
 * which is the only way a refusal reaches the model in words that name the current shape.
 */
export function prepareBrowserArguments(raw: unknown): unknown {
  const retired = retiredInteractionMessage(stepAlias(raw))
  if (retired) throw new Error(retired)
  return rewriteBrowserArguments(raw)
}
