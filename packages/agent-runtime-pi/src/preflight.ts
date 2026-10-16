import {
  clampThinkingLevel,
  type Api as PiApi,
  type Model as PiModel,
  type ModelThinkingLevel,
  type ThinkingLevel,
} from '@earendil-works/pi-ai'

import type { Message } from '@localixai/agent'

/**
 * Checks a request against what the resolved model actually declares, BEFORE any network
 * call — and settles what the model CAN serve when the request asks for something it cannot.
 *
 * The distinction is the whole point. An image bound for a text-only model is unservable:
 * nothing can be dropped that leaves the request meaning what it meant. A reasoning effort
 * the model does not offer is not: every model that reasons at all reasons at SOME level, and
 * "think a bit less than you were asked to" is the same request. Rejecting it terminated live
 * sessions for a setting the person had chosen against a different model and never revisited —
 * `openrouter/deepseek-v4-flash does not support reasoning effort "minimal"`, and the run was
 * over.
 *
 * pi, the runtime underneath, already draws that line: `clampThinkingLevel` walks to the
 * nearest level the model declares (upward first, then down) and never refuses. This module
 * uses pi's own answer rather than a second opinion about it.
 */

/** A request the resolved model cannot serve. Terminal: no retry can make it servable. */
export class PreflightRejection extends Error {
  readonly code: 'unsupported_content'

  constructor(code: PreflightRejection['code'], message: string) {
    super(message)
    this.name = 'PreflightRejection'
    this.code = code
  }
}

/** Efforts that ask the provider for reasoning; `off`/absent asks for none. */
type RequestedEffort = string | undefined

/** What a request will actually ask of the model, once the model has been consulted. */
export interface ResolvedReasoning {
  /** The level to send, or undefined for no reasoning at all (pi's `off` has no wire form). */
  effort: ThinkingLevel | undefined
  /** Set when the request asked for something else — for the caller to report, not to fail on. */
  clampedFrom?: string
}

/**
 * The reasoning level this model will actually be asked for: pi's `clampThinkingLevel` against the
 * model's `thinkingLevelMap`, nothing else.
 *
 * `off` is a level like any other. A model whose map says `off: null` cannot switch reasoning
 * off, and sending no level would leave the PROVIDER's default in charge (`high` on Anthropic's
 * managed-effort models), so pi clamps it to the least reasoning the model offers. A model that
 * does not reason is asked for none.
 */
export function resolveReasoningEffort(
  model: PiModel<PiApi>,
  requested: RequestedEffort,
): ResolvedReasoning {
  if (requested === undefined) return { effort: undefined }
  if (!model.reasoning) {
    return requested === 'off'
      ? { effort: undefined }
      : { effort: undefined, clampedFrom: requested }
  }
  const clamped = clampThinkingLevel(model, requested as ModelThinkingLevel)
  const effort: ThinkingLevel | undefined = clamped === 'off' ? undefined : clamped
  if (clamped === requested) return { effort }
  return { effort, clampedFrom: requested }
}

/** True when any message carries an image part. */
function carriesImage(messages: readonly Message[]): boolean {
  for (const message of messages) {
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if ((part as { type?: string } | null)?.type === 'image') return true
    }
  }
  return false
}

/**
 * Throw if the resolved model cannot serve this request at all. Silent when it can — and
 * silent about anything the model does not declare.
 */
export function assertRequestServable(input: {
  model: PiModel<PiApi>
  messages: readonly Message[]
}): void {
  if (!input.model.input.includes('image') && carriesImage(input.messages)) {
    throw new PreflightRejection(
      'unsupported_content',
      `${input.model.provider}/${input.model.id} accepts ${input.model.input.join('/')} input only, and this request carries an image`,
    )
  }
}
