/**
 * TEXT-INPUT COMPLETION — the port behind "suggest the rest of what I am typing" for a field a
 * plugin owns (a commit subject, a query, a name).
 *
 * The host owns the one auxiliary-model call, the debounce, the deadline, the cancellation AND
 * the context budget. A surface says only what grounds its own field and how to read the answer
 * back; everything the user is working with (open tabs, linked chips) the host gathers through
 * Context Fabric for every surface alike, so a new field gets that context without code.
 *
 * Every member is given the caller's `payload` because a surface can serve several shapes of the
 * same field (an empty draft wants a whole subject, a half-typed one wants only the suffix) and
 * the host cannot tell those apart.
 */
import type { ContextContribution } from './context-fabric'

/** Whatever the requesting client sent along with the caret — the surface validates its own shape. */
export type PluginTextInputCompletionPayload = unknown

export interface PluginTextInputCompletionRequest {
  readonly userId: string
  readonly sessionId: string
  readonly payload: PluginTextInputCompletionPayload
  /** Aborts when the user types on, or navigates away, mid-flight. */
  readonly signal?: AbortSignal
  /**
   * When the host stops waiting, as `Date.now()` ms. A surface doing its own I/O must check this
   * BEFORE and AFTER each await: returning late is the same as returning nothing, but it still
   * costs the call.
   */
  readonly deadlineAtMs?: number
}

export interface PluginTextInputCompletionSurface {
  /** Stable id the client asks for, namespaced by the owning plugin (`git-workspace.commit`). */
  readonly id: string

  /**
   * What grounds THIS field, as contributions. The host admits them through the same policy as
   * any provider (secret shapes are withheld) and clips them to one core budget, so a surface
   * cannot make a keystroke expensive. Return `[]` to decline — never throw to decline.
   */
  resolveContext: (
    request: PluginTextInputCompletionRequest,
  ) => Promise<readonly ContextContribution[]>

  /** Whether a completion is worth asking for at all, given the payload and admitted context. */
  actionable: (payload: PluginTextInputCompletionPayload, context: string) => boolean

  /** The prompt fragment carrying the admitted context, plus whatever the payload adds to it. */
  buildFragment: (payload: PluginTextInputCompletionPayload, context: string) => string

  /** What the model is being asked for, in one sentence, for this exact payload. */
  instruction: (payload: PluginTextInputCompletionPayload) => string

  /** Trim the raw completion to what may be inserted — the surface owns its own field's rules. */
  clean: (raw: string, payload: PluginTextInputCompletionPayload) => string
}
