import type { MessageBinding } from '@localixai/agent'
import type { MiniAppContext } from './context'

/**
 * Lifecycle-hook + memory-provider type contracts for native mini apps. These are
 * pure type/interface declarations (plus the cap constants) describing the events
 * the host runtime hands to a mini app's hooks and what each hook may return.
 */

/**
 * Event handed to `onPreToolCall` — fired before EVERY tool execution (built-in, mini app, MCP).
 */
export interface PreToolCallEvent {
  toolName: string
  /** The model-validated input as it stands (earlier mini apps' rewrites already applied). */
  input: unknown
  sessionId: string
}

/**
 * `onPreToolCall` outcome:
 * - `void` / `undefined` — observe only, call proceeds.
 * - `{ block: string }` — the call is blocked; the string is surfaced to the model as the tool error.
 * - `{ input: unknown }` — replaces the call's input. The rewrite must re-parse against the
 *   tool's input schema — if it doesn't, the rewrite is ignored (logged) and the original input runs.
 */
export type PreToolCallHookResult = void | { block: string } | { input: unknown }

/**
 * Event handed to `onPostToolCall` — fired after every tool execution that RETURNS.
 *
 * A tool that THROWS bypasses this hook: the throw propagates past the host's wrapper into the
 * agent loop, which turns it into an error result the hook never sees. A tool that wants its
 * failures observable (or annotatable) must return `{ isError: true }` rather than throw.
 */
export interface PostToolCallEvent {
  toolName: string
  /** The input the tool actually ran with (after any pre-hook rewrites). */
  input: unknown
  /** The tool's result (content + details). Treat as read-only — return `{ appendContent }` to annotate. */
  result: { content: string; details?: unknown }
  sessionId: string
}

/**
 * `onPostToolCall` outcome: `void` to observe only, or any of:
 * - `{ replaceContent: string }` — REPLACES the model-facing tool result content
 *   (redaction, summarization). Non-empty string required; later mini apps' post
 *   hooks see the replaced content. `details` are untouched.
 * - `{ appendContent: string }` — appends a short note to the result content
 *   (capped at 1KB, prefixed with the mini app name). Applied after any replace.
 */
export type PostToolCallHookResult = void | { replaceContent?: string; appendContent?: string }

/** Event handed to `onUserMessage` — fired once per run, before the model sees the prompt. */
export interface UserMessageEvent {
  sessionId: string
  /** Id of the persisted user message that started this run. */
  messageId: string
  /** The prompt text as it stands (earlier mini apps' rewrites already applied). */
  text: string
}

/**
 * `onUserMessage` outcome: `void` to observe only, or `{ text }` to rewrite the
 * MODEL-FACING prompt for this run. The persisted message (what the user sees in
 * the transcript) is never changed — same philosophy as pre-tool input rewrites.
 */
export type UserMessageHookResult = void | { text: string }

/** Event handed to `onAssistantMessage` — fired once per run, after the final reply is complete. */
export interface AssistantMessageEvent {
  sessionId: string
  /** Id of the assistant message being finalized. */
  messageId: string
  /** The final assistant text for the run. */
  content: string
}

/**
 * `onAssistantMessage` outcome: `void` to observe only, or any of:
 * - `{ content }` — replaces the persisted assistant text (e.g. strip raw file
 *   paths after turning them into asset bindings). Must be a non-empty string.
 * - `{ bindings }` — assets, linked context, or invocation metadata added to the
 *   assistant message through the same parent contract used by every producer.
 *   Capped by {@link ASSISTANT_BINDINGS_MAX} and
 *   {@link ASSISTANT_BINDING_DATA_CAP_BYTES}; malformed entries are dropped.
 */
export type AssistantMessageHookResult = void | {
  content?: string
  bindings?: MessageBinding[]
}

/** Max bindings all mini apps together may add to one assistant message. */
export const ASSISTANT_BINDINGS_MAX = 8
/** Max model-bearing payload per mini-app-added binding. */
export const ASSISTANT_BINDING_DATA_CAP_BYTES = 8 * 1024 * 1024

/** Event handed to `onSubagentStop` — fired when a child session of this run finishes. */
export interface SubagentStopEvent {
  /** Parent session id (the session whose run spawned the child). */
  sessionId: string
  childSessionId: string
  status: 'completed' | 'failed' | 'stopped'
  /** Wall-clock from child start to terminal status, ms (0 when the start wasn't observed). */
  durationMs: number
  /** The child's final reply text, when available. */
  summary?: string
}

/** Event handed to `onHitlRequest` — fired when a run blocks on a human (observer-only). */
export interface HitlRequestEvent {
  sessionId: string
  requestId: string
  kind: 'confirm' | 'ask' | 'quiz' | 'config_change'
  toolName: string
  title?: string
  /** Kind-specific request payload (confirm: command/cwd/description; ask/quiz: questions). */
  payload: unknown
}

/** Event handed to `onHitlResolved` — fired when a pending HITL request is answered or dismissed. */
export interface HitlResolvedEvent {
  sessionId: string
  requestId: string
  kind: 'confirm' | 'ask' | 'quiz' | 'config_change'
  toolName: string
  /** The answers payload. Absent when dismissed. */
  response?: unknown
  /** True when the request was dismissed/cancelled instead of answered (confirm only —
   * a dismissed ask/quiz fails its tool call without a response event). */
  dismissed?: boolean
}

/**
 * Event handed to `onHumanAssigned` — fired when a board card in a chat is assigned to the person
 * (`@human`), so it now waits on them (observer-only). Nothing blocks on the hook. Agents never
 * address the person by mention; their questions arrive as `onHitlRequest`.
 */
export interface HumanAssignedEvent {
  sessionId: string
  /** The key of the notice that raised it (the card). */
  messageId: string
  /** The assigning agent's handle ('' when none). */
  from: string
  /** A notice-sized excerpt of what waits on them. */
  text: string
}

/**
 * Optional lifecycle hooks a native module may export. All hooks below are wired:
 *
 * - `onSessionStart(ctx)` — once per session, when its first run starts.
 * - `onUserMessage(event)` — once per run, before the model sees the prompt; may
 *   rewrite the model-facing prompt text (persisted message unchanged).
 * - `onPreToolCall(event)` — before every tool call; may block or rewrite input.
 * - `onPostToolCall(event)` — after every tool call that RETURNS (a throw bypasses
 *   it — see {@link PostToolCallEvent}); may replace the model-facing result and/or
 *   append a note to it.
 * - `onAssistantMessage(event)` — once per run, when the final reply is complete;
 *   may replace the persisted text and/or add message bindings.
 * - `onSessionEnd(event)` — when a run finishes (fired once per RUN, not per logical
 *   session — continuation runs fire it again).
 * - `onSubagentStop(event)` — when a child session (sub-agent / delegated task run / CLI
 *   executor run) reaches a terminal status. Observer-only.
 * - `onHitlRequest(event)` / `onHitlResolved(event)` — when a run blocks on a human
 *   (confirm/ask/quiz) and when that request is answered or dismissed. Observer-only —
 *   hooks cannot veto or pre-answer.
 * - `onHumanAssigned(event)` — when a board card is assigned to the person, so an external
 *   channel can tell them. Observer-only.
 *
 * Every hook may be async. Each invocation is isolated per-mini-app (a throwing hook is
 * logged and never breaks the turn) and capped at 5 seconds (timeout ⇒ treated as void).
 * Hooks are added here ONLY when a host call site actually invokes them — a
 * declared-but-never-called hook is dead contract surface.
 */
export interface MiniAppHooks {
  onSessionStart?: (ctx: MiniAppContext) => void | Promise<void>
  onUserMessage?: (
    event: UserMessageEvent,
  ) => UserMessageHookResult | Promise<UserMessageHookResult>
  onPreToolCall?: (
    event: PreToolCallEvent,
  ) => PreToolCallHookResult | Promise<PreToolCallHookResult>
  onPostToolCall?: (
    event: PostToolCallEvent,
  ) => PostToolCallHookResult | Promise<PostToolCallHookResult>
  onAssistantMessage?: (
    event: AssistantMessageEvent,
  ) => AssistantMessageHookResult | Promise<AssistantMessageHookResult>
  onSessionEnd?: (event: { sessionId: string }) => void | Promise<void>
  onSubagentStop?: (event: SubagentStopEvent) => void | Promise<void>
  onHitlRequest?: (event: HitlRequestEvent) => void | Promise<void>
  onHitlResolved?: (event: HitlResolvedEvent) => void | Promise<void>
  onHumanAssigned?: (event: HumanAssignedEvent) => void | Promise<void>
}

// ---------------------------------------------------------------------------
// Memory providers — external long-term memory backends (Honcho, Mem0, …)
// ---------------------------------------------------------------------------

/** Event handed to `loadContext` — once per run, while the system prompt is assembled. */
export interface MemoryLoadContextEvent {
  sessionId: string
  projectId: string | null
  /** The user prompt that starts this run (model-facing, after onUserMessage rewrites). */
  prompt: string
  /** The built-in memory notes already loaded for this run ('' when none). */
  builtinContext: string
}

/** Event handed to `onRunEnd` — after the run's final reply is complete (extraction point). */
export interface MemoryRunEndEvent {
  sessionId: string
  projectId: string | null
  userText: string
  assistantText: string
}

/**
 * An external long-term memory backend, returned from a native module's
 * `register(ctx)` as `memory: {...}`. At most ONE provider is active at a time
 * (first enabled mini app wins; later declarations are ignored with a warning) —
 * it AUGMENTS the built-in memory tool/notes rather than replacing the feature:
 *
 * - `loadContext(event)` — once per run while the system prompt is built. The
 *   returned `context` becomes the "# Memory context" section: `mode: 'replace'`
 *   (default) swaps the built-in notes out, `'append'` adds below them. Void /
 *   empty → built-in behavior. Capped at {@link MEMORY_CONTEXT_CAP_CHARS};
 *   isolated with a {@link MEMORY_TIMEOUT_MS} timeout (timeout ⇒ built-in notes).
 * - `onRunEnd(event)` — fire-and-forget after each completed run, with the
 *   turn's user prompt + final assistant text — the extraction/consolidation
 *   point (store observations, update the user model, …).
 *
 * State: persist under `ctx.stateDir`; credentials come from manifest `config`.
 */
export interface MemoryProvider {
  loadContext(
    event: MemoryLoadContextEvent,
  ):
    | Promise<{ context?: string; mode?: 'replace' | 'append' } | void>
    | { context?: string; mode?: 'replace' | 'append' }
    | void
  onRunEnd?(event: MemoryRunEndEvent): void | Promise<void>
}

/** Hard cap for a provider-supplied memory context (chars) — prompt real estate. */
export const MEMORY_CONTEXT_CAP_CHARS = 8000
/** Memory backends do network round-trips — more generous than hook timeouts. */
export const MEMORY_TIMEOUT_MS = 10_000
