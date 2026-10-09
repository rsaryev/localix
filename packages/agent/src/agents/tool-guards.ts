import type { AgentToolResult } from './tool-result'

// ---- Tool guards ---------------------------------------------------------------

/**
 * A guard's decision (NestJS-guard-like): `undefined` = allow the call; `{ block:
 * true, result }` = deny it and hand `result` back to the model as the tool's
 * result. Deliberately POLICY-FREE — @localixai/agent provides only the mechanism +
 * the two evaluation points (see {@link AgentTool.guard} / {@link AgentTool.streamGuard});
 * concrete guards live in the host (apps/api) and attach to a tool definition.
 */
export type GuardVerdict<TDetails = unknown> =
  | { block: true; result: AgentToolResult<TDetails> }
  | undefined

/** Context for a tool's PRE-EXECUTE guard (after Zod validation, before execute). */
export interface ToolGuardContext<TInput = unknown> {
  toolCallId: string
  /** The validated tool input. */
  input: TInput
  /** The run's abort signal, when the host wires it through. */
  signal?: AbortSignal
}

/**
 * STREAMING early guard. The agent loop evaluates it DURING generation, the moment
 * every `requiredFields` key is present (and terminated) in the partially-parsed
 * tool-call JSON — so a call that is already doomed (e.g. a blind overwrite of an
 * unread file) can be aborted BEFORE its large body finishes streaming, saving the
 * wasted output tokens. `evaluate` receives only the fields streamed so far.
 *
 * Keep it fast and side-effect-light: it runs on the hot streaming path. When it
 * blocks, the loop aborts ONLY the provider stream (an internal controller, never
 * the user signal) and synthesizes the tool result from the verdict, so the model
 * sees exactly the denial it would get from the pre-execute {@link AgentTool.guard}.
 * Always pair a streamGuard with a pre-execute `guard` carrying the SAME logic — it
 * is the backstop for calls that finish streaming before the guard can fire.
 */
export interface ToolStreamGuard<TDetails = unknown> {
  /** Top-level arg keys needed to decide (e.g. ['path']). Put them FIRST in the schema. */
  requiredFields: string[]
  evaluate(
    partialInput: Record<string, unknown>,
  ): Promise<GuardVerdict<TDetails>> | GuardVerdict<TDetails>
}
