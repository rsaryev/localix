/**
 * Agent-based CC hooks (`type:"agent"`) — the injected-evaluator seam.
 *
 * An agent hook is a tool-using verifier: the hook's `prompt` + the event input
 * JSON drive a small, bounded sub-agent (Read/Grep/Glob-style tools, capped turns)
 * that must end with `{ "ok": boolean, "reason"?: string }`. Like prompt hooks, the
 * verdict maps onto a {@link CcHookOutcome} via `mapPromptOutcome`, so agent + prompt
 * hooks SHARE the whole fold layer — only the evaluation differs (one LLM call vs a
 * tool-using sub-agent run).
 *
 * The sub-agent run is injected by the chat runtime (cc-hooks stays chat-agnostic)
 * via {@link AgentHookEvaluator}, which reuses the delegate/subsession machinery.
 * It MUST fail open (`{ok:true}`) on any error/timeout — the runtime never throws.
 *
 * Pure type module — no chat/UI imports.
 */
import type { PromptHookResult } from './prompt-hook'

/**
 * The injected bounded-sub-agent evaluator. Given the hook prompt, the event input
 * JSON, an optional model hint, a timeout, and an optional turn cap, it runs a
 * verifier sub-agent and returns its parsed `{ok, reason}`. Fail-open on any error.
 */
export type AgentHookEvaluator = (opts: {
  prompt: string
  inputJson: string
  model?: string
  timeoutMs: number
  signal?: AbortSignal
  maxTurns?: number
}) => Promise<PromptHookResult>
