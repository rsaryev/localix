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
 *   - `prompt`    — the four LLM-gate events (Stop / SubagentStop / UserPromptSubmit
 *                   / PreToolUse — see {@link CC_PROMPT_HOOK_EVENTS});
 *   - `agent`     — the same four gate events as `prompt` (a tool-using verifier
 *                   sub-agent, verdict mapped identically — {@link CC_AGENT_HOOK_EVENTS}).
 * A type on an unsupported event is dropped at parse time (recorded in `skipped`),
 * never thrown. `Notification` fires (observer-only) when a HITL request surfaces —
 * see the note in `run.ts`.
 *
 * Pure type + constant module — no chat/UI imports.
 */

/** The lifecycle events this host actually dispatches CC hooks for. */
export const CC_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionEnd',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  // Notification fires (observer-only) when a HITL request surfaces — see run.ts.
  'Notification',
] as const
export type CcHookEvent = (typeof CC_HOOK_EVENTS)[number]

export function isCcHookEvent(value: string): value is CcHookEvent {
  return (CC_HOOK_EVENTS as readonly string[]).includes(value)
}

/**
 * The subset of {@link CC_HOOK_EVENTS} whose matcher targets a TOOL name (so a
 * handler `if` guard is meaningful). On every other event a handler that carries
 * an `if` never runs (CC §3). SubagentStart/Stop match an AGENT type, not a tool,
 * so they are NOT tool events for `if` purposes.
 */
export const CC_TOOL_EVENTS = ['PreToolUse', 'PostToolUse'] as const
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
 * Events on which a `type:"prompt"` (LLM-evaluated) handler is supported, per the
 * CC spec matrix (hooks.md §7). On every other event a prompt handler is dropped
 * at parse time (we do not fire it). Other handler types use their own event
 * policies below.
 */
export const CC_PROMPT_HOOK_EVENTS = [
  'Stop',
  'SubagentStop',
  'UserPromptSubmit',
  'PreToolUse',
] as const satisfies readonly CcHookEvent[]
export function isPromptHookEvent(event: CcHookEvent): boolean {
  return (CC_PROMPT_HOOK_EVENTS as readonly string[]).includes(event)
}
/** Default timeout (seconds) for a `type:"prompt"` handler when it omits `timeout` (CC: 30 s). */
export const CC_PROMPT_HOOK_DEFAULT_TIMEOUT_SEC = 30

/**
 * Events on which a `type:"agent"` (tool-using verifier sub-agent) handler is
 * supported. CC's spec matrix lists `agent` among the "all five types" event set;
 * we scope it to the same four gate events as `prompt` because the verdict fold
 * ({@link CcHookEvent} → `{ok,reason}` mapping in `prompt-hook.ts`) is only
 * meaningful there. Elsewhere an `agent` handler is dropped at parse time.
 */
export const CC_AGENT_HOOK_EVENTS = CC_PROMPT_HOOK_EVENTS
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
/**
 * Events on which an `mcp_tool` handler is supported — CC allows it on EVERY
 * event (SessionStart included, though servers may not be connected that early).
 */
export function isMcpToolHookEvent(_event: CcHookEvent): boolean {
  return true
}

/**
 * Default per-hook wall-clock timeout (seconds) when a `command` handler omits
 * `timeout`. CC's documented default for `command`/`http`/`mcp_tool` hooks is
 * 600 s (60 s is the `agent`-hook default). Event-
 * specific lower overrides (UserPromptSubmit → 30 s, SessionEnd budget) are not
 * modeled — the per-hook `timeout` field always wins over this default.
 */
export const CC_HOOK_DEFAULT_TIMEOUT_SEC = 600
/**
 * Hard ceiling on a hook's `timeout`, however large it declares. CC documents no
 * hard cap; we pick 1800 s (30 min) as a sane runaway guard — well above the
 * heaviest real hook (security-guidance's SDK bootstrap declares 180 s).
 */
export const CC_HOOK_MAX_TIMEOUT_SEC = 1800
/** Max stdout/stderr bytes captured from a hook (protects the context window). */
export const CC_HOOK_MAX_OUTPUT_BYTES = 64 * 1024
/** Max chars of `additionalContext` a PostToolUse hook may append to a tool result. */
export const CC_POST_APPEND_CAP_BYTES = 4 * 1024

/**
 * One normalized handler, ready to execute. Shell-command path placeholders
 * (`${CLAUDE_PROJECT_DIR}`, `${CLAUDE_PLUGIN_ROOT}`) stay in `command` and expand
 * from the child environment. HTTP URLs receive text substitutions at parse time.
 */
export interface CcHookHandler {
  source: CcHookSource
  /**
   * Handler type (CC `type`). Absent ⇒ `command` (back-compat with pre-prompt-hook
   * registries):
   *   - `command`  — spawn a shell hook (stdin JSON / exit-code / stdout protocol);
   *   - `prompt`   — one non-streaming aux-LLM evaluation returning `{ok,reason}`;
   *   - `http`     — POST the input JSON to {@link httpUrl}, fold the response body;
   *   - `mcp_tool` — call the connected MCP tool {@link mcpTool}, fold its text;
   *   - `agent`    — a bounded tool-using verifier sub-agent returning `{ok,reason}`.
   */
  kind?: 'command' | 'prompt' | 'http' | 'mcp_tool' | 'agent'
  /** Prompt text for a `kind:"prompt"`/`"agent"` handler; the event input JSON is appended. */
  prompt?: string
  /** Optional eval-model hint for a `kind:"prompt"`/`"agent"` handler (advisory). */
  promptModel?: string
  /** CC `maxTurns` for a `kind:"agent"` verifier (default {@link CC_AGENT_HOOK_DEFAULT_MAX_TURNS}). */
  agentMaxTurns?: number
  /** POST target URL for a `kind:"http"` handler (path placeholders already substituted). */
  httpUrl?: string
  /**
   * Extra request headers for a `kind:"http"` handler. Values may reference env
   * vars (`$VAR` / `${VAR}`); only names in {@link httpAllowedEnvVars} are expanded
   * (unlisted refs become empty strings). Interpolation happens at FIRE time.
   */
  httpHeaders?: Record<string, string>
  /** Allowlist of env-var names an `http` handler's header/url interpolation may read. */
  httpAllowedEnvVars?: string[]
  /**
   * Full MCP tool name for a `kind:"mcp_tool"` handler. Both the CC form
   * (`mcp__server__tool`) and the Localix namespaced form (`mcp_server_tool`) are
   * accepted; the runtime normalizes before matching a gathered tool.
   */
  mcpTool?: string
  /** Plugin name when `source === 'plugin'`. */
  pluginName?: string
  /** Plugin install dir → `CLAUDE_PLUGIN_ROOT` env for the spawned child. */
  pluginRoot?: string
  /** Plugin persistent data dir → `CLAUDE_PLUGIN_DATA` env for the spawned child. */
  pluginDataDir?: string
  /**
   * Shell command (`sh -c <command>`). Empty for prompt handlers. Its `${CLAUDE_*}` placeholders
   * are NOT substituted: the shell expands them from the child env, so a project path is never
   * parsed as shell source (`config-handler.ts` `bindShellCommand`).
   */
  command: string
  /**
   * Variables the command reads in place of its `${user_config.KEY}` tokens
   * (`CLAUDE_PLUGIN_OPTION_<KEY>`), merged into the child env by the executor.
   */
  shellEnv?: Record<string, string>
  /** Resolved timeout in milliseconds (default + cap already applied). */
  timeoutMs: number
  /**
   * CC `if` — an optional secondary permission-rule guard (e.g. `Bash(git commit:*)`),
   * evaluated against `tool_name`/`tool_input` BEFORE the hook is spawned. Applies
   * only on tool events ({@link isToolEvent}); on other events a handler with an
   * `if` never runs. Best-effort + fail-open (see `if-guard.ts`).
   */
  if?: string
  /**
   * CC `async` — fire-and-forget: the hook runs in the background and never blocks
   * the turn; its `decision`/`permissionDecision`/`continue` fields have no effect.
   */
  async?: boolean
  /**
   * CC `asyncRewake` — implies {@link async}. When the background hook exits 2 it
   * WAKES an idle session, surfacing {@link rewakeMessage} + the hook's stderr (or
   * stdout when stderr is empty) as a fresh turn.
   */
  asyncRewake?: boolean
  /** Message prepended to the wake payload when an `asyncRewake` hook fires. */
  rewakeMessage?: string
  /** Short one-line summary of an `asyncRewake` wake (surfaced as its provenance). */
  rewakeSummary?: string
  /** CC `once` — run at most once per session, then never again. */
  once?: boolean
}

/** A matcher group: an optional matcher plus the handlers that run when it matches. */
export interface CcHookGroup {
  /** CC matcher string. `undefined`/`''`/`'*'` ⇒ match all. */
  matcher?: string
  handlers: CcHookHandler[]
}

/** The merged, normalized registry: event → ordered matcher groups (all sources fused). */
export type CcHookRegistry = Partial<Record<CcHookEvent, CcHookGroup[]>>

export type { CcHookInput, CcHookOutcome } from './protocol-types'
