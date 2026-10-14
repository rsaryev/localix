import type { HumanInLoopController } from './human-in-loop'
import type { AsyncToolRegistry } from './tool-actions'
import type { AgentToolResult } from './tool-result'

/**
 * Generic per-session host capability handed to every tool's execution context.
 * Deliberately app/UI-agnostic: it carries the session id, a session-scoped
 * scratch directory any tool may use, and a generic live-data channel to a client
 * renderer. This is the growth point that lets feature tools (e.g. the bundled
 * extension-owned renderers live OUTSIDE core without the host hardcoding their concepts —
 * the host wires it once; plugins consume it. Optional; tools tolerate its absence.
 */
export interface ToolSessionContext {
  /** The current session id. */
  id: string
  /** A session-scoped scratch directory a tool may write/read (host-writable). */
  scratchDir: string
  /**
   * The agent this run speaks as, bound by the host.
   *
   * A tool that records WHO did something — a board card taken, a claim made — must not take the
   * actor from its input, where a model could name any agent. The host knows which participant's
   * turn it is; it stamps that here. Absent when the run has no addressable speaker.
   */
  speaker?: {
    /** The stable registry identity. */
    agentId: string
    /** The name the conversation addresses it by, without `@`. */
    handle: string
  }
  /**
   * Publish ONE plugin→UI command as a typed, REPLAYABLE session-stream frame. The host
   * wraps it into its stream envelope keyed by `plugin` + `channel`; the plugin's
   * UI registers a matching sink (a per-plugin command registry) on the client.
   * Non-coalescing: every call is delivered in order, and a reconnecting client
   * replays missed commands (deduped client-side by the envelope's command id).
   * Optional — hosts without a command stream omit it, and tools must say so
   * honestly instead of pretending the command landed.
   */
  emitCommand?(plugin: string, channel: string, payload: unknown): void
  /**
   * The round-trip variant of {@link emitCommand}: publish the command AND await
   * the client sink's reply, correlated server-side by the frame's `commandId`
   * (mirroring the `browser` tool's probe relay). The promise always settles —
   * never rejects: no client answering within the timeout resolves
   * `{ ok: false, noReply: true }`, so a tool can report "the UI didn't answer"
   * honestly instead of crashing. Optional and narrower than it looks: only hosts
   * with a client→server reply RPC wire it; tools must tolerate its absence.
   */
  emitCommandWithReply?(
    plugin: string,
    channel: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<ToolCommandReplyOutcome>
}

/**
 * How a {@link ToolSessionContext.emitCommandWithReply} round-trip ended. `result`
 * is opaque to core — the plugin's two ends share its shape (same idiom as the
 * command payload). `noReply` distinguishes "no client answered" (tab closed /
 * client offline — not a defect) from an explicit failure the sink reported.
 */
export type ToolCommandReplyOutcome =
  | { ok: true; result: unknown }
  | { ok: false; error: string; noReply?: boolean }

export interface AgentToolExecutionContext {
  humanInLoop?: HumanInLoopController
  /** Available when agent-runner supports kill / background-process tracking. */
  asyncRegistry?: AsyncToolRegistry
  /**
   * Host-owned final boundary for sensitive tool output. Applied after execute and
   * before the result is cached, streamed or returned to the model.
   */
  sanitizeResult?: (result: AgentToolResult) => AgentToolResult
  /** Same boundary for a tool that throws instead of returning an error result. */
  sanitizeError?: (error: unknown) => unknown
  /**
   * Same boundary for anything a tool SHOWS rather than returns — a nested agent's tool arguments,
   * a progress detail. Applied before the value is recorded, streamed or persisted, never before
   * execute: redacting what runs would break the command.
   *
   * A host that renders a CHILD agent's activity needs this: those inputs come from another process
   * and land in the parent's transcript, where `sanitizeResult` never sees them.
   */
  sanitizeInput?: (value: unknown) => unknown
  /**
   * Whether a prompt raised through {@link humanInLoop} would actually reach a human
   * on this run's surface, when the host wires it through. A tool that must PAUSE on a
   * user-facing overlay reads this to fail fast with an actionable result instead of
   * blocking on a prompt nobody will answer (or dying when the host refuses to surface
   * it). Distinct from the tool's `exposure` policy, which removes a whole tool
   * from unsupported run shapes: this lets a MIXED tool keep the actions that need no
   * human and decline only the ones that do.
   *
   * Generic and optional; tools must tolerate it being absent, and absent means
   * "assume reachable" so a host that does not wire it keeps its current behaviour.
   */
  interactive?: boolean
  /** Generic per-session host capability (id + scratch dir + live-data channel); see {@link ToolSessionContext}. */
  session?: ToolSessionContext
}
