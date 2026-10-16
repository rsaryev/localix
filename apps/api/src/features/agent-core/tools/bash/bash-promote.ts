import type {
  AgentToolResult,
  AgentToolExecutionContext,
  AgentToolUpdateCallback,
} from '@localixai/agent/agents'

import { modelFacingOutput } from './bash-output'
import { adoptChildBgProc } from './bash-process'
import { runBackgroundCommand } from './bash-background'
import type { BashToolInput, BashToolDetails } from './bash-types'
import type { DetachedChild } from '../environments/spawn'
import type { BashRunContext } from './bash-run'

/**
 * What happens when a FOREGROUND command outruns its timeout.
 *
 * It used to be killed: the process tree was reaped and the model got exit 124 as an
 * error, so work that was merely slower than its budget was destroyed and the model had
 * to start over having learned only that the budget was too small. Instead the still
 * running child is handed over (`spawnToResult`'s `onTimeout: 'detach'`) and adopted by
 * the ordinary job machinery — same lifecycle, same `jobs` verbs, same completion wake.
 *
 * The capacity check is the other half. Promotion acquires jobs WITHOUT the model asking
 * for them, so an unbounded session could pin arbitrarily many processes; at the cap an
 * honest timeout is the better answer, and the child is reaped after all.
 */

/**
 * Live background jobs one session may hold at once. Occupancy is read from the host's
 * own job records (never a second counter that could drift from them), and capacity
 * frees when a job actually settles rather than when a kill is merely requested.
 */
export const MAX_BACKGROUND_JOBS_PER_SESSION = 10

/**
 * The cap for work the model ASKS for — `background:true`, an interactive pane. It used to be
 * checked only below, for a call promoted for outrunning its timeout, so it bounded the accident
 * and not the request. Refused before anything spawns, so there is nothing to reap.
 */
export function refuseAtJobCap(
  context: AgentToolExecutionContext | undefined,
): AgentToolResult<BashToolDetails> | null {
  const running = context?.asyncRegistry?.countBackgroundJobs?.() ?? 0
  if (running < MAX_BACKGROUND_JOBS_PER_SESSION) return null
  return {
    content:
      `Not started: ${running} background jobs already running (limit ${MAX_BACKGROUND_JOBS_PER_SESSION}). ` +
      'Stop the ones that have served with `jobs` action="list"/"stop", then retry.',
    isError: true,
  }
}

/** Foreground capture, joined the way the ordinary result path joins it. */
export function joinCapture(capture: { stdout: string; stderr: string }): string {
  return (capture.stdout + (capture.stderr ? '\n' + capture.stderr : '')).trimEnd()
}

export interface PromoteOptions {
  ctx: BashRunContext
  toolCallId: string
  input: BashToolInput
  cwd: string
  execCommand: string
  command: string
  timeoutSecs: number
  startMs: number
  wallTimeMs: number
  detached: DetachedChild
  signal: AbortSignal | undefined
  onUpdate: AgentToolUpdateCallback<BashToolDetails> | undefined
  context: AgentToolExecutionContext | undefined
}

/**
 * Promote a handed-over child to a background job, or — at the session's job cap —
 * reap it and report the timeout honestly.
 */
export async function promoteTimedOutCommand(
  options: PromoteOptions,
): Promise<AgentToolResult<BashToolDetails>> {
  const { detached, command, cwd, timeoutSecs, wallTimeMs, onUpdate, context } = options
  const running = context?.asyncRegistry?.countBackgroundJobs?.() ?? 0

  if (running >= MAX_BACKGROUND_JOBS_PER_SESSION) {
    // Promoting here would pin one more process AND hand back a job id competing for
    // attention with a full set the model has not reaped yet. The timeout message is
    // something it already knows how to act on.
    detached.child.kill('SIGKILL')
    const capped =
      joinCapture(detached) +
      `\n[Timed out after ${timeoutSecs}s — not promoted to a background job: ` +
      `${running} already running (limit ${MAX_BACKGROUND_JOBS_PER_SESSION}). ` +
      `Reap some with \`jobs\` action="list"/"stop", then retry.]`
    const details: BashToolDetails = {
      command,
      cwd,
      output: capped,
      isStreaming: false,
      exitCode: -1,
      wallTimeMs,
      jobStatus: 'timeout',
    }
    onUpdate?.(details)
    return {
      content: modelFacingOutput(capped, {
        command,
        toolCallId: options.toolCallId,
        spillPath: null,
      }),
      details,
      isError: true,
    }
  }

  const proc = adoptChildBgProc(detached.child, joinCapture(detached))
  return runBackgroundCommand(
    options.ctx,
    options.toolCallId,
    options.input,
    cwd,
    options.execCommand,
    // A promoted job outlived a foreground budget; do not re-arm that same budget
    // against it as a background kill timer. 0 = runs until it is done.
    0,
    options.startMs,
    options.signal,
    onUpdate,
    context,
    { proc, foregroundSecs: timeoutSecs },
  )
}
