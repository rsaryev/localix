/**
 * Claude Code declarative hooks — the normalized handler and the registry built from enabled
 * plugins and run-scoped skill/agent hooks. The events, sources and limits they name live in
 * `contracts.ts`, which re-exports these types.
 */
import type { CcHookEvent, CcHookSource } from './contracts'

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
  /** CC `input` of a `kind:"mcp_tool"` handler: the tool's arguments, `${path}` still unresolved. */
  mcpInput?: Record<string, unknown>
  /** CC `continueOnBlock` of a `kind:"prompt"` handler: an `ok:false` reason goes back to Claude. */
  continueOnBlock?: boolean
  /** Plugin name when `source === 'plugin'`. */
  pluginName?: string
  /** Plugin install dir → `CLAUDE_PLUGIN_ROOT` env for the spawned child. */
  pluginRoot?: string
  /** Plugin persistent data dir → `CLAUDE_PLUGIN_DATA` env for the spawned child. */
  pluginDataDir?: string
  /**
   * Shell form: the command the shell runs; its `${CLAUDE_*}` placeholders are left for the shell
   * to expand from the child env (`config-handler.ts`). Exec form: the executable, placeholders
   * substituted. Empty for non-command handlers.
   */
  command: string
  /** CC exec form: the argument vector, placeholders substituted; spawned with no shell. */
  args?: string[]
  /** CC `shell` (shell form only): `powershell` runs the command through PowerShell. */
  shell?: 'bash' | 'powershell'
  /** Extra child env: every `CLAUDE_PLUGIN_OPTION_<KEY>`, plus the shell-form config bindings. */
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
  /** CC `statusMessage` — shown while the hook runs. */
  statusMessage?: string
  /**
   * CC `onFailure: "block"` (command and http hooks): a hook that cannot start, exits with a code
   * other than 0 or 2, times out or prints invalid output does what exit 2 does on its event.
   */
  onFailure?: 'block'
}

/** A matcher group: an optional matcher plus the handlers that run when it matches. */
export interface CcHookGroup {
  /** CC matcher string. `undefined`/`''`/`'*'` ⇒ match all. */
  matcher?: string
  handlers: CcHookHandler[]
}

/** The merged, normalized registry: event → ordered matcher groups (all sources fused). */
export type CcHookRegistry = Partial<Record<CcHookEvent, CcHookGroup[]>>
