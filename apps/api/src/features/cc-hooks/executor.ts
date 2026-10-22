/**
 * Command-hook executor: spawn one CC `command` hook and fold its result into a
 * normalized {@link CcHookOutcome}.
 *
 * Protocol (per the CC hooks reference):
 *   - JSON input arrives on the child's STDIN.
 *   - Exit 0  → parse stdout as optional JSON output (or plain text for the
 *               context-adding events); apply the universal + event fields.
 *   - Exit 2  → BLOCKING error; stdout/JSON ignored, stderr text is the reason.
 *   - other   → non-blocking error; a warning is logged, execution continues.
 *
 * The child runs `sh -c <command>` with the user's full login-shell environment
 * (via `childEnv`, so a GUI-launched app still finds the user's PATH/tools) plus
 * `CLAUDE_PROJECT_DIR` (and `CLAUDE_PLUGIN_ROOT` + `CLAUDE_PLUGIN_DATA` for plugin
 * hooks). A per-hook
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
import { foldHookOutput, worktreePathFromText } from './output-parse'
import { runHookCommand } from '../lifecycle-hooks/command'

export interface HookLogger {
  warn: (msg: string) => void
  info?: (msg: string) => void
}

/** External environment conventions and input protocol remain inside this adapter. */
function runCommandHook(handler: CcHookHandler, input: string, cwd: string, signal?: AbortSignal) {
  return runHookCommand({
    command: handler.command,
    input,
    cwd,
    timeoutMs: handler.timeoutMs,
    maxOutputBytes: CC_HOOK_MAX_OUTPUT_BYTES,
    signal,
    env: childEnv({
      // The command's `${user_config.KEY}` values, bound as variables rather than pasted into it.
      ...handler.shellEnv,
      CLAUDE_PROJECT_DIR: cwd,
      ...(handler.pluginRoot ? { CLAUDE_PLUGIN_ROOT: handler.pluginRoot } : {}),
      ...(handler.pluginDataDir ? { CLAUDE_PLUGIN_DATA: handler.pluginDataDir } : {}),
    }),
  })
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
): Promise<CcHookOutcome> {
  const label = handler.pluginName ? `plugin:${handler.pluginName}` : handler.source
  const result = await runCommandHook(handler, JSON.stringify(input), cwd, signal)
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
  // Any other exit code (or spawn error) → non-blocking error.
  const firstLine = result.stderr.split('\n')[0]?.trim()
  logger.warn(
    `[cc-hook:${label}] ${input.hook_event_name} hook exited ${result.code ?? 'error'}${firstLine ? `: ${firstLine}` : ''} — non-blocking, continuing`,
  )
  return { failed: 'error' }
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
 * so it cannot block or influence the turn's decision. The only channel back is
 * `asyncRewake`: when such a hook exits 2, its armed rewake fires with the handler's
 * `rewakeMessage` plus its stderr (or stdout when stderr is empty) so an idle
 * session picks the feedback up as a fresh turn; any other ending dismisses it.
 * All failures are swallowed.
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
): void {
  const label = handler.pluginName ? `plugin:${handler.pluginName}` : handler.source
  const armed = handler.asyncRewake && rewake ? rewake().catch(() => null) : undefined
  void runCommandHook(handler, JSON.stringify(input), cwd, signal)
    .then(async (result) => {
      const notice = await armed
      if (result.aborted) return notice?.dismiss('aborted')
      if (result.timedOut) {
        logger.warn(
          `[cc-hook:${label}] ${input.hook_event_name} async hook timed out after ${handler.timeoutMs}ms`,
        )
        return notice?.dismiss('timeout')
      }
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
