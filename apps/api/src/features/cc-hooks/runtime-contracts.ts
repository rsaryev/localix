import type { CcHookEvent, CcHookRegistry, CcHookSource } from './contracts'
import type { HookLogger, HookRewake } from './executor'
import type { CcMcpToolCaller } from './mcp-tool-hook'
import type { PromptHookEvaluator } from './prompt-hook'
import type { AgentHookEvaluator } from './agent-hook'

/** Aggregated PreToolUse decision handed to the tool wrapper. */
export interface PreToolUseResult {
  /** `deny` blocks the call; `allow`/`ask` are advisory; `proceed` = no opinion. */
  decision: 'deny' | 'allow' | 'ask' | 'proceed'
  reason?: string
  /** Composed input rewrite (re-validated by the caller against the tool schema). */
  updatedInput?: unknown
  didRewrite: boolean
}

export interface PromptSubmitResult {
  blocked: boolean
  reason?: string
  additionalContext?: string
}

export interface StopResult {
  blocked: boolean
  reason?: string
}

/**
 * What `PreCompact` handlers answered. A context checkpoint is announced to them but never
 * waits on or yields to them — see `run/stages/history.ts` — so `blocked` is reported, not obeyed.
 */
export interface PreCompactResult {
  blocked: boolean
  reason?: string
}

export interface CcHooksRuntime {
  /** True when at least one supported hook is registered AND the feature is enabled. */
  readonly active: boolean
  /**
   * Fire the SessionStart hooks. `source` (CC: `startup` | `resume` | `clear` |
   * `compact`, default `startup`) is both reported in the hook input AND used as
   * the matcher value — a hook whose matcher is `compact` only fires on a `compact`
   * source. Returns the joined `additionalContext` to inject into the model.
   */
  runSessionStart(source?: string): Promise<{ additionalContext?: string }>
  runUserPromptSubmit(prompt: string): Promise<PromptSubmitResult>
  runPreToolUse(toolName: string, input: unknown, toolUseId?: string): Promise<PreToolUseResult>
  runPostToolUse(
    toolName: string,
    input: unknown,
    result: { content: string; details?: unknown },
  ): Promise<{ additionalContext?: string; updatedToolOutput?: string }>
  /** Fire the PostToolUseFailure hooks for a tool that threw; they may add context. */
  runPostToolUseFailure(
    toolName: string,
    input: unknown,
    failure: { error: string; isInterrupt: boolean },
  ): Promise<{ additionalContext?: string }>
  /**
   * Fire the Stop hooks. `stopHookActive` is reported to hooks as `stop_hook_active`
   * — true when this run is ALREADY a Stop-hook-forced continuation (CC loop
   * protection). A `decision:"block"` outcome is surfaced as `{blocked, reason}` for
   * the caller to re-enter the run with.
   */
  runStop(opts?: { stopHookActive?: boolean }): Promise<StopResult>
  /** Session-terminating side-effect hooks. Fire-and-forget (no decision control). */
  runSessionEnd(reason: string): Promise<void>
  /**
   * Fire the Notification hooks — CC's "agent needs the user" signal, raised when a
   * HITL request (ask/quiz/confirm) surfaces. `notificationType` (e.g.
   * `permission_prompt` for a confirm gate, `agent_needs_input` for an ask/quiz) is
   * both reported to hooks AND used as the matcher value. Observer-only side-effect
   * (no decision control, per the CC spec) — fire-and-forget, output ignored.
   */
  runNotification(notification: {
    message: string
    notificationType?: string
    title?: string
  }): Promise<void>
  /** A sub-agent is starting. Returns context to inject into the child (advisory). */
  runSubagentStart(agentType: string, agentId: string): Promise<{ additionalContext?: string }>
  /**
   * A sub-agent finished. `decision:block` is logged (no re-entry), like Stop.
   * `sourcesOnly` restricts firing to the given hook sources — used when a
   * sub-agent run fires its OWN SubagentStop for its scoped (skill/agent)
   * frontmatter hooks, so generic user/project SubagentStop hooks (which the
   * PARENT already fires via the delegate seam) are not double-fired.
   */
  runSubagentStop(
    agentType: string,
    agentId: string,
    lastMessage: string | null,
    opts?: { sourcesOnly?: readonly CcHookSource[]; stopHookActive?: boolean },
  ): Promise<StopResult>
  /**
   * Claude Code's PreCompact: exit 2 / `decision:block` reports a block. This host fires it
   * with `auto` when a context checkpoint is taken, after the view is already decided, so it
   * reads the result as a notice and never lets a block stop the turn.
   */
  runPreCompact(trigger: 'manual' | 'auto', customInstructions?: string): Promise<PreCompactResult>
}

export interface CreateCcHooksRuntimeOptions {
  signal?: AbortSignal
  registry: CcHookRegistry
  sessionId: string
  /** Session cwd → hook cwd + `CLAUDE_PROJECT_DIR`. */
  projectDir: string
  /** Kill switch — when false the runtime is inert. */
  enabled: boolean
  logger: HookLogger
  /**
   * Arms the one wake an `asyncRewake` hook may send, as it starts; the hook's exit 2 fires it
   * with the composed rewake message, any other ending dismisses it.
   * Absent → asyncRewake degrades to plain `async` (fire-and-forget, no wake).
   */
  rewake?: HookRewake
  /**
   * Per-SESSION set of `once`-handler keys that already ran (owned by the caller
   * so it survives across the per-run runtimes). Absent → `once` is not enforced.
   */
  onceKeys?: Set<string>
  /**
   * Injected single-shot LLM evaluator for `type:"prompt"` handlers. Absent → prompt
   * handlers fail open (treated as `ok`, never block). Keeps cc-hooks chat-agnostic.
   */
  evaluatePromptHook?: PromptHookEvaluator
  /**
   * Injected bounded-sub-agent evaluator for `type:"agent"` handlers (a tool-using
   * verifier). Absent → agent handlers fail open. Keeps cc-hooks chat-agnostic.
   */
  runAgentHook?: AgentHookEvaluator
  /**
   * Injected MCP tool caller for `type:"mcp_tool"` handlers, built by the chat
   * runtime from the process-lifetime MCP client manager. Absent → mcp_tool handlers
   * fail open. Keeps cc-hooks free of any MCP-feature import.
   */
  callMcpTool?: CcMcpToolCaller
  /**
   * Injected sink for a hook's non-blocking `systemMessage` — a user-facing
   * warning (CC: "shown to the user in the transcript"). The chat runtime wires
   * this to publish a `hook.notice` stream event. Absent → the message is dropped
   * (keeps cc-hooks chat/UI-agnostic). Identical CONSECUTIVE messages within a run
   * are de-duped before this fires.
   */
  emitNotice?: (message: string, event: CcHookEvent) => void
}
