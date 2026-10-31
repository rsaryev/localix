/**
 * Single-command foreground execution and timeout handover to a background job.
 * Sequential batches live in `bash-batch.ts`; both use `BashRunContext` from
 * `bash-run-context.ts`. Historical run-path exports remain available here.
 * Background job lifecycle management lives in `bash-background.ts`.
 */
import { timeoutNotice } from './bash-timeout-notice'
import type {
  AgentToolResult,
  AgentToolExecutionContext,
  AgentToolUpdateCallback,
} from '@localixai/agent/agents'

import { modelFacingOutput, spillFullOutput, SPILL_MIN_BYTES, truncate } from './bash-output'
import type { BashToolInput, BashJobStatus, BashToolDetails } from './bash-types'
import { isTerminationSignalExit } from '../../../../lib/process-exit'
import { isFailedExit, isNoFindingsExit, NO_FINDINGS_NOTE } from './soft-exit'
import { joinCapture, promoteTimedOutCommand } from './bash-promote'
import type { BashRunContext } from './bash-run-context'

export { resolveCwd, type BashRunContext } from './bash-run-context'
export { runBatchCommands } from './bash-batch'

type Updater = AgentToolUpdateCallback<BashToolDetails>
type Ctx = AgentToolExecutionContext

// ── Foreground mode — routed through ExecutionEnvironment ─────────────
export async function runForegroundCommand(
  ctx: BashRunContext,
  toolCallId: string,
  input: BashToolInput,
  cwd: string,
  execCommand: string,
  timeoutSecs: number,
  startMs: number,
  signal: AbortSignal | undefined,
  onUpdate: Updater | undefined,
  context: Ctx | undefined,
): Promise<AgentToolResult<BashToolDetails>> {
  // Guarded by the caller: this path is only reached when `command` is set.
  const command = input.command!
  onUpdate?.({ command, cwd, output: '', isStreaming: true })

  const unregisterActions = context?.asyncRegistry?.registerActions(toolCallId, {
    kill: {
      label: 'Kill',
      icon: 'square',
      execute: () => {
        context?.asyncRegistry?.abortSession?.()
      },
    },
  })

  try {
    // Ask for a HANDOVER rather than a kill at the deadline: a command that merely
    // outran its budget is still doing the work the model asked for, and killing it
    // throws that away AND leaves the model to start over. Only where a job could
    // have been requested in the first place (and only the local backend can honour
    // it — ssh/docker have no local child, so they still time out normally).
    const result = await ctx.env.exec(execCommand, {
      cwd,
      timeout: timeoutSecs,
      signal,
      pathPrefix: ctx.pluginBinDirs,
      ...(ctx.allowBackground ? { onTimeout: 'detach' as const } : {}),
    })
    unregisterActions?.()
    const wallTimeMs = Date.now() - startMs

    if (result.detached) {
      // Outran the budget but still working: hand it to the job machinery, or report an
      // honest timeout when the session is already at its job cap. See bash-promote.ts.
      return promoteTimedOutCommand({
        ctx,
        toolCallId,
        input,
        cwd,
        execCommand,
        command,
        timeoutSecs,
        startMs,
        wallTimeMs,
        detached: result.detached,
        signal,
        onUpdate,
        context,
      })
    }

    const timedOut = result.exitCode === 124
    const combined = joinCapture(result)
    const output = truncate(combined)
    // Each stream on its own when there is stderr: a Claude Code PostToolUse hook reads Bash's
    // `stdout` and `stderr` apart (`ext/cc-tool-responses.ts`).
    const streams = result.stderr?.trim()
      ? {
          stdout: truncate(result.stdout.trimEnd()),
          stderr: truncate((result.stderr ?? '').trimEnd()),
        }
      : {}
    const spillPath =
      combined.length > SPILL_MIN_BYTES ? await spillFullOutput(combined, toolCallId) : null

    if (timedOut) {
      const finalOutput = output + `\n${timeoutNotice(timeoutSecs, output)}`
      onUpdate?.({
        command: command,
        cwd,
        output: finalOutput,
        isStreaming: false,
        exitCode: -1,
        wallTimeMs,
        jobStatus: 'timeout',
      })
      return {
        content: modelFacingOutput(finalOutput, { command, toolCallId, spillPath }),
        details: {
          command: command,
          cwd,
          output: finalOutput,
          isStreaming: false,
          exitCode: -1,
          wallTimeMs,
          jobStatus: 'timeout',
        },
        isError: true,
      }
    }

    // A stop-signal exit (SIGTERM 143 from a killed `npm run dev`, a watch-reload
    // SIGKILL, ^C) means the process was TOLD to stop — NOT a task failure. Crash
    // signals (SIGSEGV etc.) are excluded by isTerminationSignalExit and still fail.
    // Likewise a bare grep/diff-family exit 1 is a findings STATUS (see soft-exit.ts) —
    // without this, three greps that legitimately found nothing count toward the
    // loop's consecutive-tool-errors stop.
    const terminated = isTerminationSignalExit(result.exitCode)
    const softNoFindings = !terminated && isNoFindingsExit(command, result.exitCode)
    const isError = isFailedExit(command, result.exitCode)
    const jobStatus: BashJobStatus = isError ? 'failed' : 'completed'
    const finalOutput = isError
      ? output + `\n[exit ${result.exitCode}]`
      : terminated
        ? output + `\n[terminated (signal ${result.exitCode - 128})]`
        : softNoFindings
          ? `${output ? output + '\n' : ''}${NO_FINDINGS_NOTE}`
          : output
    onUpdate?.({
      command: command,
      cwd,
      output: finalOutput,
      isStreaming: false,
      exitCode: result.exitCode,
      wallTimeMs,
      jobStatus,
    })
    return {
      content:
        modelFacingOutput(finalOutput, { command, toolCallId, spillPath }) ||
        (isError ? `Process exited with code ${result.exitCode}` : '(no output)'),
      details: {
        command: command,
        cwd,
        output: finalOutput,
        ...streams,
        isStreaming: false,
        exitCode: result.exitCode,
        wallTimeMs,
        jobStatus,
      },
      isError,
    }
  } catch (err) {
    unregisterActions?.()
    const wallTimeMs = Date.now() - startMs
    const message = err instanceof Error ? err.message : 'Process failed'
    onUpdate?.({
      command: command,
      cwd,
      output: message,
      isStreaming: false,
      exitCode: -1,
      wallTimeMs,
      jobStatus: 'failed',
    })
    return {
      content: message,
      details: {
        command: command,
        cwd,
        output: message,
        isStreaming: false,
        exitCode: -1,
        wallTimeMs,
        jobStatus: 'failed',
      },
      isError: true,
    }
  }
}
