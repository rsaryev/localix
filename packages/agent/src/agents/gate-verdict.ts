import type { ToolGateProvenance } from './types'

/**
 * The permission gate's verdict on one call — what `beforeToolCall` returns.
 *
 * Its own module because the verdict grew a second audience: the model reads `blockedMessage`,
 * the person reads `personMessage`, and `types.ts` (the agent's whole vocabulary) is past the
 * size this repository lets one file reach.
 */
export interface BeforeToolCallResult {
  block?: boolean
  blockedMessage?: string
  /**
   * Who said no, when `block` is true. `automatic` — policy alone decided (a deny rule, a
   * mode confinement, or an approval nobody was there to give). `human` — a person declined
   * this call.
   *
   * The distinction is not presentational: a breaker counting refusals must not count a
   * person steering their own run, and a blocked call reaches no tool wrapper and no
   * after-tool hook, so the verdict is the only place the difference still exists.
   */
  refusal?: 'automatic' | 'human'
  /**
   * What the PERSON reads about a refusal, when `block` is true.
   *
   * `blockedMessage` is written for the model — "AUTO-DENIED — nobody answered…", "Do NOT
   * retry it…" — and the tool card used to show exactly that, so a person who pressed Deny
   * was told in red that "User declined bash" as though someone else had. The model keeps its
   * instruction verbatim; this is the sentence for the transcript ("You declined bash").
   */
  personMessage?: string
  /**
   * A note prepended to the tool's result content when the call is allowed — so the
   * model learns context it otherwise wouldn't see (e.g. "the user explicitly approved
   * this action"). Ignored when `block` is true.
   */
  note?: string
  /**
   * Display-only provenance of an allow decision (see {@link ToolGateProvenance}).
   * Rides the `tool_execution_end` event onto the tool item — never the model wire.
   */
  provenance?: ToolGateProvenance
}
