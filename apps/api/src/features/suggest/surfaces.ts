/**
 * Text-input surface adapters. The completion core knows only that each surface
 * has a typed payload, an admitted and clipped context string, prompt rules,
 * and an output cleaner. Domain context is loaded outside this registry.
 *
 * A MINI APP field needs none of this: it declares a `MiniAppTextInputCompletionSurface` on its
 * backend subsystem. Only a surface core itself owns is added here (plus its payload in the
 * browser-safe map and its validation in `ws-commands.ts`).
 */

import type {
  InlineCompletionSurfaceId,
  InlineCompletionSurfacePayloads,
} from '../inline-completion/contracts'
import { cleanCompletionSuffix, completionDraftTail } from '@localixai/mini-app-sdk/backend'

/** Opaque at the registry boundary: a spec narrows its own payload, the core never does. */
type AnyPayload = unknown

export interface InlineCompletionSurfaceSpec<TPayload = AnyPayload> {
  /** No model call when neither the draft nor resolved domain context can anchor it. */
  actionable(payload: TPayload, context: string): boolean
  /** Surface-specific prompt block. `context` is opaque text resolved by its adapter. */
  buildFragment(payload: TPayload, context: string): string
  /** One-line output instruction for this surface's labeled reply. */
  instruction(payload: TPayload): string
  /** Normalize the reply into append-only ghost text (`''` means no completion). */
  clean(raw: string, payload: TPayload): string
}

const MAX_DRAFT_BYTES = 400
const MAX_COMPLETION_CHARS = 180

/**
 * Per-surface prompt bytes this module adds on top of the resolved domain context:
 * the clipped draft plus the fixed labels, headings, and instruction line around it.
 * A generous constant rather than a measurement — it exists so the caller's declared
 * input budget stays derived from real limits instead of a hand-picked number.
 */
export const SURFACE_FRAMING_BYTE_CEILING = MAX_DRAFT_BYTES * 6 + 600

/**
 * The one ceiling on a surface's OWN context (a transcript digest, a commit change set), applied
 * by the service to every surface — core's and a mini app's — before `actionable`/`buildFragment`
 * see it. Surfaces used to clip themselves, and one did not: a commit context passed through
 * whole while the declared budget assumed it was clipped like the chat digest.
 */
export const SURFACE_CONTEXT_BYTE_CEILING = 12 * 1024

/**
 * Normalize a model reply into an append-only suffix shared by every text input.
 * It accepts either a full completion that echoes the draft or a suffix-only
 * reply and strips presentation wrappers while preserving exact insertion whitespace.
 */
export function cleanInlineCompletion(raw: string, draft = ''): string {
  return cleanCompletionSuffix(raw, draft, MAX_COMPLETION_CHARS)
}

/**
 * Clip a context BLOCK to a byte ceiling while keeping its line structure.
 *
 * `clip` collapses whitespace to one line, which is right for a draft and wrong for a diff. This
 * one truncates on a line boundary and says so, so a commit change set stays readable.
 *
 * It exists because the ceilings were enforced only by CONVENTION. A producer's own limit (the
 * digest's, the commit change set's) bounds what IT emits, and `declaredInputTokenBudget` is
 * derived from those — but nothing checked the value arriving at the prompt. Measured: a 2 MB
 * context yielded a 1953 KiB prompt, and both surfaces together 3.8 MiB, while the declared
 * budget still claimed ~7k tokens. The service now clips EVERY surface's context with this at
 * `SURFACE_CONTEXT_BYTE_CEILING`, so the declared budget is true by construction.
 */
export function clipContextBlock(text: string, maxBytes: number): string {
  const trimmed = text.trim()
  if (Buffer.byteLength(trimmed, 'utf8') <= maxBytes) return trimmed
  const notice = '\n… (context truncated)'
  const budget = Math.max(0, maxBytes - Buffer.byteLength(notice, 'utf8'))
  let kept = Buffer.from(trimmed, 'utf8').subarray(0, budget).toString('utf8')
  // Drop a trailing partial code point and then the trailing partial line.
  kept = kept.replace(/\uFFFD$/, '')
  const lastNewline = kept.lastIndexOf('\n')
  if (lastNewline > budget * 0.5) kept = kept.slice(0, lastNewline)
  return `${kept.trimEnd()}${notice}`
}

const chatSurface: InlineCompletionSurfaceSpec<InlineCompletionSurfacePayloads['chat']> = {
  actionable: (payload, context) => Boolean(context.trim() || payload.draft.trim()),
  buildFragment: (payload, context) => {
    const blocks: string[] = []
    if (context) blocks.push(context)
    const draft = completionDraftTail(payload.draft, MAX_DRAFT_BYTES)
    if (draft) {
      if (draft.length < payload.draft.length)
        blocks.push('Earlier input omitted; continue the exact tail below.')
      blocks.push(`Current chat input: ${JSON.stringify(draft)}`)
    }
    return blocks.join('\n\n')
  },
  // An EMPTY input is the person's reply to the assistant's last message, not a guess at a new
  // task: answer what it ended on (a question, an offer, a choice) the way this person writes,
  // briefly. Nothing to reply to — a finished report, a plain statement — is "" by design: a
  // ghost under every answer is noise the person learns to ignore, and costs the same each time.
  instruction: (payload) =>
    payload.draft.trim()
      ? 'only the exact short suffix that naturally completes the current chat input in its language and style; preserve joining whitespace, continue unfinished words directly, and never repeat the typed prefix'
      : 'the user’s most likely short reply to the assistant’s LAST message — e.g. a direct answer to the question or offer it ends with — in the language and tone the user writes in, at most one sentence; "" when that message asks nothing and invites no obvious reply',
  clean: (raw, payload) => cleanInlineCompletion(raw, payload.draft),
}

/**
 * The surfaces CORE owns. A mini app's live beside these, resolved through the completion
 * capability.
 */
const CORE_SURFACES: {
  [K in keyof InlineCompletionSurfacePayloads]: InlineCompletionSurfaceSpec<
    InlineCompletionSurfacePayloads[K]
  >
} = {
  chat: chatSurface,
}

/** Type-erased lookup for core's own ids; `undefined` for anything else. */
export function coreInlineCompletionSurface(
  id: InlineCompletionSurfaceId,
): InlineCompletionSurfaceSpec | undefined {
  return (CORE_SURFACES as Record<string, InlineCompletionSurfaceSpec>)[id]
}
