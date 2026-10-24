import type { CcHookEvent, CcHookRegistry, CcHookSource } from './contracts'
import type { HookLogger, HookRewake } from './executor'
import type { CcMcpToolCaller } from './mcp-tool-hook'
import type { PromptHookEvaluator } from './prompt-hook'
import type { AgentHookEvaluator } from './agent-hook'
import type { CcAddedHooksRuntime } from './runtime-contracts-added'
import type { CcDisplayHooksRuntime } from './runtime-display-hooks'
import type { CcWorktreeHooksRuntime } from './runtime-worktree-hooks'
import type { CcSessionEnvFiles } from './session-env'
import type { CcTranscript } from './transcript'

/** Aggregated PreToolUse decision handed to the tool wrapper. */
export interface PreToolUseResult {
  /**
   * `deny` blocks the call; `allow` skips the permission card and `ask` forces one (the gate
   * reads both, `agent-core/permission-hook-decision.ts`); `proceed` = no opinion.
   */
  decision: 'deny' | 'allow' | 'ask' | 'proceed'
  /** The deny reason for the model, or the `permissionDecisionReason` an ask shows the person. */
  reason?: string
  /** Composed input rewrite (re-validated by the caller against the tool schema). */
  updatedInput?: unknown
  didRewrite: boolean
  /** Every handler's `additionalContext`, for the model beside the tool result. */
  additionalContext?: string
  /** `continue:false`: the call is refused and the run ends; `reason` was shown to the person. */
  stop?: { reason: string }
}

/**
 * A hook ended this run: a PreToolUse `continue:false` or a PostToolBatch block. Claude Code
 * "stops processing entirely", so no end-of-turn hook or continuation may restart the agent.
 */
export interface CcRunStop {
  event: 'PreToolUse' | 'PostToolBatch'
  reason: string
}

export interface PromptSubmitResult {
  blocked: boolean
  reason?: string
  additionalContext?: string
  /** `hookSpecificOutput.sessionTitle`: rename the session, as `/rename` does. */
  sessionTitle?: string
}

export interface StopResult {
  blocked: boolean
  reason?: string
  /** The agent continues on a hook's `additionalContext` (feedback), not on a block. */
  feedback?: true
}

/**
 * What `PreCompact` handlers answered. A block skips a proactive context checkpoint and fails a
 * turn whose checkpoint recovers from a context-limit error — see `run/stages/view.ts`.
 */
export interface PreCompactResult {
  blocked: boolean
  reason?: string
}

/**
 * A tool as the tool events receive it: its engine name, or the tool itself, whose aliases
 * (an MCP tool's `mcp__<server>__<tool>`) a matcher may name and whose `mcpServer` a hook reads.
 */
export type CcHookToolRef =
  | string
  | {
      name: string
      aliases?: readonly string[]
      mcpServer?: { readonly name: string; readonly source: string }
    }

export interface CcHooksRuntime
  extends CcAddedHooksRuntime, CcDisplayHooksRuntime, CcWorktreeHooksRuntime {
  /** True when at least one supported hook is registered AND the feature is enabled. */
  readonly active: boolean
  /**
   * Fire the SessionStart hooks. `source` (CC: `startup` | `resume` | `clear` |
   * `compact`, default `startup`) is both reported in the hook input AND used as
   * the matcher value — a hook whose matcher is `compact` only fires on a `compact`
   * source. Returns the joined `additionalContext` to inject into the model, and the
   * `watchPaths` a handler named for `FileChanged`, and the `sessionTitle` one gave (not on a
   * `clear` or `compact` source).
   */
  runSessionStart(
    source?: string,
  ): Promise<{ additionalContext?: string; watchPaths?: string[]; sessionTitle?: string }>
  runUserPromptSubmit(prompt: string): Promise<PromptSubmitResult>
  runPreToolUse(tool: CcHookToolRef, input: unknown, toolUseId?: string): Promise<PreToolUseResult>
  runPostToolUse(
    tool: CcHookToolRef,
    input: unknown,
    result: { content: string; details?: unknown },
    toolUseId?: string,
    /** How long the tool ran (hooks.md `duration_ms`), when measured. */
    durationMs?: number,
  ): Promise<{ additionalContext?: string; updatedToolOutput?: string }>
  /** Fire the PostToolUseFailure hooks for a tool that threw; they may add context. */
  runPostToolUseFailure(
    tool: CcHookToolRef,
    input: unknown,
    /** `durationMs`: how long the tool ran (hooks.md `duration_ms`), when measured. */
    failure: { error: string; isInterrupt: boolean; durationMs?: number },
    toolUseId?: string,
  ): Promise<{ additionalContext?: string }>
  /**
   * Fire the Stop hooks. `stopHookActive` is reported to hooks as `stop_hook_active`
   * — true when this run is ALREADY a Stop-hook-forced continuation (CC loop
   * protection). A `decision:"block"` outcome is surfaced as `{blocked, reason}` for
   * the caller to re-enter the run with.
   */
  runStop(opts?: { stopHookActive?: boolean; lastAssistantMessage?: string }): Promise<StopResult>
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
   * Claude Code's PreCompact: exit 2 / `decision:block` blocks the compaction. This host fires
   * it with `auto` before a context checkpoint is committed (`run/stages/view.ts`).
   */
  runPreCompact(trigger: 'manual' | 'auto', customInstructions?: string): Promise<PreCompactResult>
  /** The hook that ended this run, the first one to; undefined while none has. */
  stoppedBy(): CcRunStop | undefined
}

export interface CreateCcHooksRuntimeOptions {
  signal?: AbortSignal
  registry: CcHookRegistry
  sessionId: string
  /** Session cwd → hook cwd + `CLAUDE_PROJECT_DIR`. */
  projectDir: string
  /** Kill switch — when false the runtime is inert. */
  enabled: boolean
  /**
   * The session's mode in Claude Code's spelling (`default`, `plan`, `bypassPermissions` …),
   * reported as `permission_mode` on the events whose documented input carries it.
   */
  permissionMode?: string
  /** The run is a delegated subagent's: every input names it (`agent_id`, `agent_type`). */
  agent?: { id: string; type: string }
  /** The session's `CLAUDE_ENV_FILE`s (session-env.ts); absent → hooks get none. */
  envFiles?: CcSessionEnvFiles
  /** The session's transcript file and how to refresh it (transcript.ts); absent → paths are ''. */
  transcript?: CcTranscript
  logger: HookLogger
  /**
   * Arms the one wake an `asyncRewake` hook may send, as it starts; the hook's exit 2 fires it
   * with the composed rewake message, any other ending dismisses it.
   * Absent → asyncRewake degrades to plain `async` (fire-and-forget, no wake).
   */
  rewake?: HookRewake
  /**
   * Per-SESSION set of spent `once`-handler keys (owned by the caller so it survives
   * across the per-run runtimes). Only a skill's hooks honour `once`, spent after their first
   * successful run. Absent → `once` is not enforced.
   */
  onceKeys?: Set<string>
  /**
   * What an `async` hook's JSON response said to Claude (`additionalContext`, `systemMessage`)
   * once it exited 0 — for the session's next turn. Absent → it is dropped.
   */
  onAsyncContext?: (context: string) => void
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
