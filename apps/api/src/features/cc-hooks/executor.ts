/**
 * Command-hook executor: spawn one CC `command` hook and fold its result into a
 * normalized {@link CcHookOutcome}.
 *
 * Protocol (per the CC hooks reference):
 *   - JSON input arrives on the child's STDIN.
 *   - Exit 0  → parse stdout as optional JSON output (or plain text for the
 *               context-adding events); apply the universal + event fields.
 *   - Exit 2  → BLOCKING error; stdout/JSON ignored, stderr text is the reason.
 *   - other   → a JSON object on stdout still decides (the exit code is ignored); otherwise a
 *               non-blocking error: a warning is logged, execution continues.
 *
 * Shell form runs `sh -c <command>` (or PowerShell); exec form (`args`) spawns the
 * executable directly with no shell. Either gets the user's full login-shell environment
 * (via `childEnv`, so a GUI-launched app still finds the user's PATH/tools) plus
 * `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_ENV_FILE` on the events that have one
 * (and `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` and every
 * `CLAUDE_PLUGIN_OPTION_<KEY>` for plugin hooks). A per-hook
 * timeout kills a stuck child.
 *
 * Layer: api feature module. Reuses the shared `childEnv` login-shell primitive.
 */
import { childEnv } from '../../lib/login-shell-env'
import {
  CC_HOOK_MAX_OUTPUT_BYTES,
  type CcHookHandler,
  type CcHookInput,
  type CcHookOutcome,
} from './contracts'
import { powershellPlaceholders } from './config-command'
import { asyncHookContext, foldHookOutput, worktreePathFromText } from './output-parse'
import { runHookCommand } from '../lifecycle-hooks/command'

export interface HookLogger {
  warn: (msg: string) => void
  info?: (msg: string) => void
}

/**
 * What one event adds to its hooks' environment: `CLAUDE_ENV_FILE` on the events Claude Code
 * gives it to (SessionStart, CwdChanged, FileChanged). Absent elsewhere, so a value the API
 * process inherited never reaches a hook that must not have one.
 */
export interface HookEnv {
  envFile?: string
  /** The `env` of Claude Code's settings for the folder (`cc-settings/settings-env.ts`). */
  settings?: Readonly<Record<string, string>>
}

/** The hook's environment: the user's, the session's id, the project, the plugin and the event's. */
function hookEnv(handler: CcHookHandler, input: CcHookInput, cwd: string, extra?: HookEnv) {
  const env = childEnv({
    // Claude Code's settings `env` first: the variables Claude Code sets for a hook still win.
    ...extra?.settings,
    // Every plugin option as `CLAUDE_PLUGIN_OPTION_<KEY>`, plus a shell-form command's
    // `${user_config.KEY}` values, bound as variables rather than pasted into it.
    ...handler.shellEnv,
    CLAUDE_PROJECT_DIR: cwd,
    // env-vars.md: matches the `session_id` field of the hook's input.
    CLAUDE_CODE_SESSION_ID: input.session_id,
    // env-vars.md: matches the input's `effort.level`.
    ...(input.effort?.level ? { CLAUDE_EFFORT: input.effort.level } : {}),
    ...(extra?.envFile ? { CLAUDE_ENV_FILE: extra.envFile } : {}),
    ...(handler.pluginRoot ? { CLAUDE_PLUGIN_ROOT: handler.pluginRoot } : {}),
    ...(handler.pluginDataDir ? { CLAUDE_PLUGIN_DATA: handler.pluginDataDir } : {}),
  })
  if (!extra?.envFile) delete env.CLAUDE_ENV_FILE
  return env
}

/** External environment conventions and input protocol remain inside this adapter. */
function runCommandHook(
  handler: CcHookHandler,
  input: CcHookInput,
  cwd: string,
  signal?: AbortSignal,
  extra?: HookEnv,
) {
  return runHookCommand({
    command: handler.command,
    ...(handler.args ? { args: handler.args } : {}),
    ...(handler.shell ? { shell: handler.shell } : {}),
    // Placeholders stay environment reads under PowerShell too (`shell: "powershell"`, or Windows
    // without Git Bash), spelled `${env:NAME}` there.
    forPowerShell: powershellPlaceholders,
    input: JSON.stringify(input),
    cwd,
    timeoutMs: handler.timeoutMs,
    maxOutputBytes: CC_HOOK_MAX_OUTPUT_BYTES,
    signal,
    // hooks.md: a PowerShell hook never gets CLAUDE_ENV_FILE.
    // A PowerShell hook gets no CLAUDE_ENV_FILE; the settings' variables it does get.
    env: hookEnv(
      handler,
      input,
      cwd,
      handler.shell === 'powershell'
        ? extra?.settings
          ? { settings: extra.settings }
          : undefined
        : extra,
    ),
  })
}

/**
 * Events whose JSON counts only on exit 0 (hooks.md): Elicitation and ElicitationResult apply
 * `hookSpecificOutput` "when your hook exits 0, and ignore it on any other exit code"; a failed
 * MessageDisplay hook shows the original text.
 */
const OUTPUT_ON_EXIT_ZERO_ONLY: ReadonlySet<string> = new Set([
  'Elicitation',
  'ElicitationResult',
  'MessageDisplay',
])

/** A JSON object on stdout, which decides a hook's outcome whatever its exit code. */
function isJsonObjectText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const value: unknown = JSON.parse(trimmed)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

/**
 * Execute one command hook and normalize its result. Never throws — a spawn
 * error / timeout / non-{0,2} exit resolves to a non-blocking `{}` (logged).
 *
 * @param allowPlainTextContext true for SessionStart / UserPromptSubmit, where
 *   non-JSON stdout is added to the model context.
 */
export async function executeHook(
  handler: CcHookHandler,
  input: CcHookInput,
  cwd: string,
  logger: HookLogger,
  allowPlainTextContext: boolean,
  signal?: AbortSignal,
  extra?: HookEnv,
): Promise<CcHookOutcome> {
  const label = handler.pluginName ? `plugin:${handler.pluginName}` : handler.source
  const result = await runCommandHook(handler, input, cwd, signal, extra)
  if (result.aborted) return {}

  if (result.timedOut) {
    logger.warn(
      `[cc-hook:${label}] ${input.hook_event_name} hook timed out after ${handler.timeoutMs}ms — ignored`,
    )
    return { failed: 'timeout' }
  }
  // WorktreeCreate reads stdout as a path, and any non-zero exit fails the creation (CC).
  if (input.hook_event_name === 'WorktreeCreate') {
    if (result.code === 0) return worktreePathFromText(result.stdout)
    const why = result.stderr.trim().split('\n')[0]?.trim()
    return { failed: 'error', reason: why || `the hook exited ${result.code ?? 'on an error'}` }
  }
  if (result.code === 2) {
    return { blocked: true, blockReason: result.stderr.trim() || 'blocked by hook (exit 2)' }
  }
  if (result.code === 0) {
    return foldHookOutput(result.stdout, allowPlainTextContext)
  }
  // hooks.md, Exit code output: a JSON object on stdout decides with "Any other exit code" too —
  // "Claude Code ignores the exit code, and the fields alone decide".
  // With `onFailure: "block"` that exit is a failure, "even if it printed JSON that allows".
  if (
    result.code !== null &&
    handler.onFailure !== 'block' &&
    !OUTPUT_ON_EXIT_ZERO_ONLY.has(input.hook_event_name) &&
    isJsonObjectText(result.stdout)
  ) {
    return foldHookOutput(result.stdout, false)
  }
  // Any other exit code (or spawn error) → non-blocking error.
  const firstLine = result.stderr.split('\n')[0]?.trim()
  logger.warn(
    `[cc-hook:${label}] ${input.hook_event_name} hook exited ${result.code ?? 'error'}${firstLine ? `: ${firstLine}` : ''} — non-blocking, continuing`,
  )
  const detail = result.stderr.trim()
  return { failed: 'error', ...(detail ? { failureDetail: detail } : {}) }
}

/**
 * Arm the one wake an `asyncRewake` hook may send, as the hook STARTS. Resolves to null when
 * none could be armed. The host arms it durably, so the wake is one delivery however often the
 * exit is reported (see `chat/runtime/exit-notices.ts`).
 */
export type HookRewake = () => Promise<{
  fire(message: string): void
  dismiss(reason: string): void
} | null>

/**
 * Fire an `async` command hook in the BACKGROUND — never awaited by the caller,
 * so it cannot block or influence the turn's decision. Two channels lead back: an exit 0
 * hands `onSucceeded` what its JSON response said to Claude (`additionalContext` and
 * `systemMessage`, which reach the model on the next turn), and with `asyncRewake` an exit 2
 * fires its armed rewake with the handler's `rewakeMessage` plus its stderr (or stdout when
 * stderr is empty) so an idle session picks the feedback up as a fresh turn; any other ending
 * dismisses it. All failures are swallowed.
 *
 * Returns immediately; the work runs on a floating promise.
 */
export function executeHookInBackground(
  handler: CcHookHandler,
  input: CcHookInput,
  cwd: string,
  logger: HookLogger,
  rewake: HookRewake | undefined,
  signal?: AbortSignal,
  extra?: HookEnv,
  /** Exit 0: the hook succeeded; `context` is what its JSON response said to Claude. */
  onSucceeded?: (context: string | undefined) => void,
): void {
  const label = handler.pluginName ? `plugin:${handler.pluginName}` : handler.source
  const armed = handler.asyncRewake && rewake ? rewake().catch(() => null) : undefined
  void runCommandHook(handler, input, cwd, signal, extra)
    .then(async (result) => {
      const notice = await armed
      if (result.aborted) return notice?.dismiss('aborted')
      if (result.timedOut) {
        logger.warn(
          `[cc-hook:${label}] ${input.hook_event_name} async hook timed out after ${handler.timeoutMs}ms`,
        )
        return notice?.dismiss('timeout')
      }
      if (result.code === 0) onSucceeded?.(asyncHookContext(result.stdout))
      // asyncRewake: exit 2 wakes the session with the rewake message + hook output.
      const feedback = result.stderr.trim() || result.stdout.trim()
      const message = [handler.rewakeMessage?.trim(), feedback].filter(Boolean).join('\n\n')
      if (result.code === 2 && message) notice?.fire(message)
      else notice?.dismiss('passed')
    })
    .catch((err) => {
      logger.warn(`[cc-hook:${label}] ${input.hook_event_name} async hook errored: ${String(err)}`)
    })
}
