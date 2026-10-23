/**
 * Browser-safe contract for text-input inline completion.
 *
 * A surface sends only the state it owns. Rich context (conversation history,
 * repository diff, branch, recent commits, …) is resolved on the server from
 * `sessionId`; callers never serialize domain data into an LLM prompt.
 */

/**
 * What the user is working with, named the way a message binding's target names it — kind,
 * token, label, optional URI and scalar attributes. The client sends identities; the server
 * resolves every one through Context Fabric in the session's own scope, so a completion reads a
 * linked file through the same admission policy as a sent message.
 *
 * `origin` ranks it: `linked` is something the user attached (a composer chip, a SQL statement's
 * tables), `ambient` is merely open on screen. The editor and every text surface share this type.
 */
export interface CompletionReference {
  kind: string
  token: string
  label: string
  uri?: string
  attributes?: Record<string, string | number | boolean>
  origin?: 'linked' | 'ambient'
}

/** References one call may carry after merging the shared working set with surface anchors. */
export const COMPLETION_REFERENCE_LIMIT = 12
/** Inline content a snippet reference may carry (its `content` attribute). */
export const COMPLETION_INLINE_CONTENT_MAX = 2_048
/**
 * How many surfaces one call may carry. The whole design is ONE model round-trip for every active
 * input, so the bound is on the prompt, not on politeness: each surface adds its own context block
 * and its own instruction line, and an unbounded map is a way to make one keystroke expensive.
 */
export const INLINE_COMPLETION_SURFACE_LIMIT = 8

export interface ChatInlineCompletionPayload {
  /** Current chat-composer value. The completion is returned as an append-only suffix. */
  draft: string
  /** The composer's own chips (typed and pinned refs) — `linked` anchors for this surface. */
  references?: CompletionReference[]
}

/**
 * The surfaces CORE itself owns. Anything else is a CONTRIBUTED surface: the id is namespaced by
 * its mini app (`<app>.<surface>`) and its payload is whatever that surface validates for
 * itself, which is why the map stops here rather than enumerating every field in the product.
 */
export interface InlineCompletionSurfacePayloads {
  chat: ChatInlineCompletionPayload
}

/** A core surface id, or a contributed one. Contributed ids must contain a `.` namespace. */
export type InlineCompletionSurfaceId = keyof InlineCompletionSurfacePayloads | (string & {})

/** Payload for a surface the request names — typed for core's, opaque for a contributed one. */
export type InlineCompletionPayloadFor<K extends InlineCompletionSurfaceId> =
  K extends keyof InlineCompletionSurfacePayloads ? InlineCompletionSurfacePayloads[K] : unknown

/** Adapter input, correlating a surface id with the payload sent for it. */
export interface InlineCompletionContextRequest {
  surface: InlineCompletionSurfaceId
  payload: unknown
}

/** Core's own surfaces, in a stable order — request fingerprints and prompts stay deterministic. */
export const INLINE_COMPLETION_SURFACE_IDS = [
  'chat',
] as const satisfies readonly (keyof InlineCompletionSurfacePayloads)[]

/**
 * A contributed surface id, distinguished by its namespace. The dot is the whole rule: core's own
 * ids never carry one, so a request cannot reach a mini app by accident and a mini app cannot claim
 * a core surface by naming it.
 */
export function isContributedSurfaceId(id: string): boolean {
  return id.includes('.')
}

export interface InlineCompletionRequest {
  sessionId: string
  /** Payload per requested surface. Core validates its own; a contributed surface validates its. */
  surfaces: Record<string, unknown>
  /**
   * The working set every surface in this call shares — what is open and visible right now.
   * Attached by the client hub, not by a surface, so a new field gets it without code.
   */
  references?: CompletionReference[]
}

/** Missing entry means the model had no useful completion for that surface. */
export type InlineCompletionResult = Record<string, string>

export type InlineCompletionOutcome =
  | 'suggested'
  | 'empty'
  | 'cancelled'
  | 'timeout'
  | 'disabled'
  | 'no_model'
  | 'error'

/** Outcomes survive transport so failures never become cached empty suggestions. */
export interface InlineCompletionResponse {
  outcome: InlineCompletionOutcome
  completions: InlineCompletionResult
  durationMs: number
}
