/**
 * TIMING: where a turn's wall-clock went, per message and aggregated per session.
 *
 * Its own module because it is a closed vocabulary that the read model merely CARRIES. The
 * fields answer one question — which phase of a turn the time was spent in — and nothing
 * else in the read model needs to know how that question is decomposed. Splitting it keeps
 * `read-model.ts` about the SHAPE a client hydrates from.
 */
/** Per-tool execution timing captured during a run. */
export interface ToolTiming {
  toolCallId: string
  toolName: string
  durationMs: number
}

/**
 * Timing telemetry for a single assistant message (may span multiple agentic turns).
 * Persisted in the message payload so it survives reload.
 */
export interface MessageTiming {
  /**
   * True LLM generation time — sum of provider read-waits per turn (from
   * `genTimings.providerReadMs`), excluding cosmetic stream-smoothing reveal.
   * Falls back to wall-clock turn time for non-streaming providers.
   */
  modelMs: number
  /**
   * Stream-smoothing / reveal overhead: per turn, the wall time between the
   * model finishing (true provider time) and the smoothed stream completing.
   * This is cosmetic delay the user waits but the model did not spend.
   */
  revealMs: number
  /** Time-to-first-token: first token (thinking|text) minus first turn start. */
  ttftMs?: number
  /**
   * Time the model spends generating tool-call arguments (first tool_call in a
   * turn → that turn's message_end), summed across turns. Subset of modelMs.
   */
  toolGenMs: number
  /**
   * Sum over turns of turn_start → first token (thinking|text): pure provider
   * latency / queue wait before the model starts emitting. Subset of modelMs.
   */
  waitMs: number
  /** Sum of tool execution durations (excludes HITL wait). */
  toolMs: number
  /** Time spent waiting on human-in-the-loop responses. */
  hitlMs: number
  /** Idle/overhead residual: totalMs − modelMs − toolMs − hitlMs. */
  idleMs: number
  /** Full wall-clock time of the run that produced this message. */
  totalMs: number
  /** Number of agentic turns contributing to this message. */
  turns: number
  /** Per-tool durations. */
  tools: ToolTiming[]
}

/**
 * Which provider + API key actually produced an assistant message. Persisted
 * alongside the message so the UI can show a minimalist "Provider · key"
 * badge in the footer, like the timing badge.
 */
export interface MessageProviderMeta {
  providerId: string
  providerName: string
  /** Raw model id (without the "provider/" prefix). */
  modelId: string
  /** Display label of the key used (e.g. "default", "oauth-2"). */
  keyLabel?: string
  /** Masked preview of the key used (e.g. "…4f2a"). */
  keyMasked?: string
}

/** Aggregate timing across all messages in a session (derived at read time). */
export interface SessionTiming {
  totalMs: number
  modelMs: number
  revealMs: number
  toolGenMs: number
  waitMs: number
  toolMs: number
  hitlMs: number
  idleMs: number
  turns: number
  runs: number
}
