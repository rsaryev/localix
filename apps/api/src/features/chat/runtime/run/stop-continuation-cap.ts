import { envInt } from '../../../../lib/env'

/**
 * Claude Code's loop protection for Stop / SubagentStop hooks that keep the turn going (hooks.md,
 * "Stop decision control"): after eight continuations in a row the next block is overridden and the
 * turn ends. The count resets each time the agent calls a tool, and
 * `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` raises the cap.
 */
export const DEFAULT_STOP_HOOK_BLOCK_CAP = 8

type EnvSource = Record<string, string | undefined>

/** The cap in force: `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` when it is a positive integer. */
export function stopHookBlockCap(env: EnvSource = process.env): number {
  return envInt('CLAUDE_CODE_STOP_HOOK_BLOCK_CAP', DEFAULT_STOP_HOOK_BLOCK_CAP, env)
}

/**
 * The consecutive-continuation count the next run carries when a stop hook blocks the end of a run
 * that had `count` before it and called `toolCalls` tools, or null when the block is overridden.
 */
export function nextStopContinuation(
  count: number,
  toolCalls: number,
  env: EnvSource = process.env,
): number | null {
  const consecutive = toolCalls > 0 ? 0 : count
  return consecutive >= stopHookBlockCap(env) ? null : consecutive + 1
}
