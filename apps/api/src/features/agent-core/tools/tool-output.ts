import { formatSize, type TruncationResult } from '@localixai/agent'
import { plural } from '../../../lib/plural'

/**
 * Shared shape of MODEL-facing tool output.
 *
 * These strings are a CONTRACT with the model, not cosmetics: the truncation
 * marker is how the agent learns that it is looking at a partial result and what
 * to do about it. Every tool that caps its output emitted its own hand-rolled
 * copy of the same sentence, so a wording fix landed in one and drifted in the
 * others. One owner now; the parts that legitimately differ per tool (the noun,
 * which end survived, the follow-up advice) stay parameters.
 */

/**
 * A count and its noun, pluralized: `1 file` / `2 files`.
 *
 * This used to be a second implementation of the `${n} thing${n === 1 ? '' : 's'}`
 * rule — one for the tools suite, one for the rest of the app. Two owners of one rule
 * is the same duplication the rule was extracted to kill, just at a coarser grain, so
 * the tools suite now RE-EXPORTS the app-wide owner rather than restating it. The
 * re-export stays because ~30 call sites in this suite import `plural` from here, and
 * moving them is churn with no reader benefit.
 */
export { plural }

/** Which end of the output survived the cap. */
export type TruncationKept = 'first' | 'last'

export interface TruncationMarkerOptions {
  /** Which end the tool kept — file reads keep the head, command output the tail. */
  kept: TruncationKept
  /** What the dropped lines ARE, singular. Defaults to `line`. */
  noun?: string
  /** Tool-specific follow-up: how the model can get at the rest. */
  advice: string
}

/**
 * The truncation notice for a capped, model-facing tool result.
 *
 * Callers place it themselves — APPENDED after a head truncation (so the content
 * still reads top-down) and PREPENDED before a tail truncation (so the model sees
 * the notice before the surviving tail, not buried under it).
 */
export function truncationMarker(r: TruncationResult, options: TruncationMarkerOptions): string {
  const dropped = r.totalLines - r.outputLines
  return (
    `… [truncated ${plural(dropped, options.noun ?? 'line')} / ` +
    `showing ${options.kept} ${r.outputLines} of ${r.totalLines} lines, ${formatSize(r.totalBytes)}. ` +
    `${options.advice}]`
  )
}
