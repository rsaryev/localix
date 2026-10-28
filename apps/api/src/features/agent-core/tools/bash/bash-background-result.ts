import { truncateTail } from '@localixai/agent'

import { truncationMarker } from '../tool-output'

/** How much of a starting job's output the immediate result carries. */
const BACKGROUND_EARLY_OUTPUT_CHARS = 4_000

/**
 * What the model reads the moment a command goes to the background.
 *
 * Three cases share one shape and must stay distinguishable, because the model's next move
 * differs in each: the job is still running (poll or wait), it exited before we even
 * returned (read the outcome, do not poll), or it was adopted after outliving a foreground
 * budget (say so, or the model reads the missing result as a failure).
 *
 * The tail is truncated with an HONEST marker carrying real counts and the exact way to read
 * more. A bare leading ellipsis told the model nothing about how much it lost, on the very
 * copy it reasons over while deciding whether the job needs attention.
 */
export function renderBackgroundStartResult(input: {
  command: string
  jobId: string
  output: string
  earlyExited: boolean
  exitCode: number | null | undefined
  /** Set when the job was adopted from a foreground call that ran out of budget. */
  adoptedAfterSecs?: number
  settleMaxMs: number
}): string {
  const truncation =
    input.output.length > BACKGROUND_EARLY_OUTPUT_CHARS
      ? truncateTail(input.output, { maxBytes: BACKGROUND_EARLY_OUTPUT_CHARS })
      : null
  const tail = truncation
    ? `${truncationMarker(truncation, {
        kept: 'last',
        advice: `Use \`Jobs\` action="read" with job_id="${input.jobId}" for more, or wait — its further output returns automatically next turn.`,
      })}\n${truncation.content}`
    : input.output

  const header = input.earlyExited
    ? `Background command exited early (exit ${input.exitCode ?? -1}): ${input.command}`
    : input.adoptedAfterSecs !== undefined
      ? `No result after ${input.adoptedAfterSecs}s — still running in the background (job_id: ${input.jobId}): ${input.command}`
      : `Background job started (job_id: ${input.jobId}): ${input.command}`
  const hint = input.earlyExited
    ? '' // already done — nothing to poll
    : `\n[still running — \`Jobs\` action="read"/"send_input" or \`TaskStop\` with job_id="${input.jobId}"; its further output also returns automatically next turn]`

  return tail.trim()
    ? `${header}\n--- output so far ---\n${tail}${hint}`
    : `${header}\n(no output in first ${Math.round(input.settleMaxMs / 1000)}s)${hint}`
}
