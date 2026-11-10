import type { CommandResult, CommandRunner } from '@rsaryev/llx-plugin'
import { runHookCommand } from '../../../lifecycle-hooks/command'

/**
 * The kit's process runs (`CommandRunner`) over Localix's hook transport, `runHookCommand`: shell
 * form through the agent's bash (or PowerShell), exec form spawned directly, the process group
 * killed on a timeout or an abort. The kit's "no time limit" (an `async` hook) is the longest timer
 * the runtime keeps; each stream is captured up to `maxOutputBytes`, and the kit applies its own
 * caps on top.
 */
export interface CommandRunnerOptions {
  readonly maxOutputBytes: number
}

/** Below the 2^31 - 1 ms a Node timer holds, with room for the transport's own drain margin. */
const NO_LIMIT_MS = 2_000_000_000

export function hostCommandRunner(options: CommandRunnerOptions): CommandRunner {
  return {
    run: async (run): Promise<CommandResult> => {
      const spec = run.spec
      const result = await runHookCommand({
        command: spec.command,
        ...(spec.form === 'exec' ? { args: spec.args } : { shell: spec.shell }),
        input: run.stdin ?? '',
        cwd: run.cwd,
        env: { ...run.env },
        timeoutMs: run.timeoutMs ?? NO_LIMIT_MS,
        maxOutputBytes: options.maxOutputBytes,
        ...(run.mergeStderr === undefined ? {} : { mergeStderr: run.mergeStderr }),
        signal: run.signal,
      })
      return {
        exitCode: result.timedOut || result.aborted ? null : result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        ...(result.startError === undefined ? {} : { startError: result.startError }),
      }
    },
  }
}
