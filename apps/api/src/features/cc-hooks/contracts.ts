/**
 * Claude Code declarative hooks — type contracts.
 *
 * These describe the CC settings-file `hooks` schema, the normalized in-memory
 * registry built from enabled plugins and run-scoped skill/agent hooks. Event inputs
 * and normalized handler outcomes live in `protocol-types.ts`.
 *
 * Scope: all five CC handler types on the events we dispatch, each on the events
 * the CC spec matrix (hooks.md §7) allows:
 *   - `command`   — every dispatched event;
 *   - `http`      — every dispatched event EXCEPT `SessionStart` (POST the input
 *                   JSON, response body folded like a command hook's stdout);
 *   - `mcp_tool`  — every dispatched event (call a connected MCP tool, its result
 *                   text folded like a command hook's stdout);
 *   - `prompt`    — the LLM-gate events ({@link CC_PROMPT_HOOK_EVENTS});
 *   - `agent`     — the same events except `PermissionRequest`
 *                   ({@link CC_AGENT_HOOK_EVENTS}).
 * A type on an unsupported event is dropped at parse time (recorded in `skipped`),
 * never thrown. The Claude Code events with no Localix lifecycle point are accepted
 * and never fire; {@link CC_INERT_HOOK_EVENTS} says why for each.
 *
 * Pure type + constant module — no chat/UI imports.
 */

/** The lifecycle events this host actually dispatches CC hooks for. */
export const CC_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  // A typed slash command or plugin command expanding into its prompt.
  'UserPromptExpansion',
  'PreToolUse',
  // A tool approval card is about to wait on the person; a hook may answer it first.
  'PermissionRequest',
  // A permission rule or the permission mode refused a call without asking anyone.
  'PermissionDenied',
  'PostToolUse',
  // A tool that threw: in place of PostToolUse, as in Claude Code.
  'PostToolUseFailure',
  // Every tool call of one model response resolved, before the next model request.
  'PostToolBatch',
  'Stop',
  // The turn ended on a provider error instead of an answer.
  'StopFailure',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  // The task board (the `kanban` tool) gained a card, or is about to close one.
  'TaskCreated',
  'TaskCompleted',
  'PreCompact',
  // A context checkpoint (this host's compaction) was taken.
  'PostCompact',
  // Notification fires (observer-only) when a HITL request surfaces — see run.ts.
  'Notification',
  // A CLAUDE.md / AGENTS.md / rules file entered the prompt.
  'InstructionsLoaded',
  // The agent's `Configure` tool, or a skill saved from Localix, changed configuration.
  'ConfigChange',
  // The session moved to a project with another working directory.
  'CwdChanged',
  // A file named by a FileChanged matcher, or by a hook's `watchPaths`, changed on disk.
  'FileChanged',
  // The session's model route changed on request (`/model`, the model picker).
  'PreModelSwitch',
  'PostModelSwitch',
  // An MCP server asks the person for input mid tool call, and the answer before it goes back.
  'Elicitation',
  'ElicitationResult',
  // The turn's text is settled; a hook may change only what is shown.
  'MessageDisplay',
  // A workflow agent with isolation: 'worktree' needs its folder: the hook makes it in git's place.
  'WorktreeCreate',
] as const
export type CcHookEvent = (typeof CC_HOOK_EVENTS)[number]

export function isCcHookEvent(value: string): value is CcHookEvent {
  return (CC_HOOK_EVENTS as readonly string[]).includes(value)
}

/**
 * Claude Code events this host accepts in a hooks file but never fires, each with the reason a
 * plugin author is shown. Only events with no lifecycle point here belong in this list.
 */
export const CC_INERT_HOOK_EVENTS = {
  Setup:
    'it fires only for the Claude Code CLI flags --init-only, -p --init and -p --maintenance; Localix starts no such one-time init or maintenance run (its first-run dialog is a UI tip with no session), so use SessionStart for per-session setup',
  DirectoryAdded:
    'a Localix session has exactly one working directory, its project folder: there is no /add-dir or register_repo_root, "Add folder" opens another project, and moving a session to another project fires CwdChanged',
  WorktreeRemove:
    "it fires only when a worktree session ends, ExitWorktree runs, claude remote-control cleans up or a background session is deleted, and Localix has none of these; a workflow agent's worktree that a WorktreeCreate hook made is kept when the agent finishes, as in Claude Code, so remove it yourself",
} as const satisfies Record<string, string>
export type CcInertHookEvent = keyof typeof CC_INERT_HOOK_EVENTS

export function isInertCcHookEvent(value: string): value is CcInertHookEvent {
  return Object.hasOwn(CC_INERT_HOOK_EVENTS, value)
}

/**
 * The subset of {@link CC_HOOK_EVENTS} whose matcher targets a TOOL name (so a
 * handler `if` guard is meaningful). On every other event a handler that carries
 * an `if` never runs (CC §3). SubagentStart/Stop match an AGENT type, not a tool,
 * so they are NOT tool events for `if` purposes.
 */
export const CC_TOOL_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
] as const
export function isToolEvent(event: CcHookEvent): boolean {
  return (CC_TOOL_EVENTS as readonly string[]).includes(event)
}

/**
 * Where a hook came from — drives the trust model + diagnostics. `skill`/`agent`
 * are the run-scoped sources: a skill's or a sub-agent's frontmatter `hooks` block,
 * merged into the registry only for the run it is scoped to.
 */
export type CcHookSource = 'user' | 'project' | 'local' | 'plugin' | 'skill' | 'agent'

/**
 * Events on which a `type:"prompt"` (LLM-evaluated) handler is supported: the events of the CC
 * matrix whose `ok:false` has an effect this host can apply (see `prompt-hook.ts`),
 * plus `PermissionRequest` and `PermissionDenied`, where CC runs a prompt hook but discards its
 * verdict. On every other event a prompt handler is dropped at parse time.
 */
export const CC_PROMPT_HOOK_EVENTS = [
  'Stop',
  'SubagentStop',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied',
  'PostToolBatch',
  'TaskCreated',
  'TaskCompleted',
] as const satisfies readonly CcHookEvent[]
export function isPromptHookEvent(event: CcHookEvent): boolean {
  return (CC_PROMPT_HOOK_EVENTS as readonly string[]).includes(event)
}
/** Default timeout (seconds) for a `type:"prompt"` handler when it omits `timeout` (CC: 30 s). */
export const CC_PROMPT_HOOK_DEFAULT_TIMEOUT_SEC = 30

/**
 * Events on which a `type:"agent"` (tool-using verifier sub-agent) handler is supported: the
 * prompt events except `PermissionRequest`, as in CC. Elsewhere an `agent` handler is dropped at
 * parse time.
 */
export const CC_AGENT_HOOK_EVENTS = CC_PROMPT_HOOK_EVENTS.filter(
  (event) => event !== 'PermissionRequest',
)
export function isAgentHookEvent(event: CcHookEvent): boolean {
  return (CC_AGENT_HOOK_EVENTS as readonly string[]).includes(event)
}
/** Default timeout (seconds) for a `type:"agent"` handler when it omits `timeout` (CC: 60 s). */
export const CC_AGENT_HOOK_DEFAULT_TIMEOUT_SEC = 60

/**
 * The event on which an `http` handler is NOT supported. CC's matrix allows
 * `http` on every event EXCEPT `SessionStart`/`Setup` (which only accept
 * `command`/`mcp_tool` — the servers/endpoints usually aren't reachable that
 * early). Localix dispatches `SessionStart` but not `Setup`.
 */
export function isHttpHookEvent(event: CcHookEvent): boolean {
  return event !== 'SessionStart'
}
/** Events on which an `mcp_tool` handler is supported: every one, SessionStart included, as in CC. */
export function isMcpToolHookEvent(_event: CcHookEvent): boolean {
  return true
}

/**
 * Default per-hook wall-clock timeout (seconds) when a `command` handler omits
 * `timeout`. CC's documented default for `command`/`http`/`mcp_tool` hooks is
 * 600 s (60 s is the `agent`-hook default); {@link CC_EVENT_DEFAULT_TIMEOUT_SEC} lowers it
 * on the events CC lowers it on. The SessionEnd budget is not modeled — the per-hook `timeout`
 * field always wins over either default.
 */
export const CC_HOOK_DEFAULT_TIMEOUT_SEC = 600
/** CC's lower `command`/`http`/`mcp_tool` default on events that hold up the person. */
export const CC_EVENT_DEFAULT_TIMEOUT_SEC: Partial<Record<CcHookEvent, number>> = {
  UserPromptSubmit: 30,
  PreModelSwitch: 30,
  PostModelSwitch: 30,
  MessageDisplay: 10,
}
/**
 * Hard ceiling on a hook's `timeout`, however large it declares. CC documents no
 * hard cap; we pick 1800 s (30 min) as a sane runaway guard — well above the
 * heaviest real hook (security-guidance's SDK bootstrap declares 180 s).
 */
export const CC_HOOK_MAX_TIMEOUT_SEC = 1800
/** Max stdout/stderr bytes captured from a hook (protects the context window). */
export const CC_HOOK_MAX_OUTPUT_BYTES = 64 * 1024
/**
 * Max chars of hook context appended to a tool result: Claude Code's 10,000-character cap per
 * string (`output-cap.ts`), for the joined notes of several hooks.
 */
export const CC_POST_APPEND_CAP_BYTES = 4 * 10_000

// The normalized handler and the registry it is collected into (`registry-types.ts`).
export type { CcHookGroup, CcHookHandler, CcHookRegistry } from './registry-types'
export type { CcHookInput, CcHookOutcome } from './protocol-types'
