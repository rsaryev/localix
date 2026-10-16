import type { VfCommandResult } from '../protocol/index'
import type { ActuateResult } from './types'

/** One-line note for a completed step in a `steps` batch. A READ action
 *  (`snapshot`/`evaluate`/`console`) carries its output on the result, not on `note`, so
 *  surface it here — otherwise an act-then-observe batch (`[{click…},{snapshot}]` /
 *  `[{click…},{evaluate 'data-theme'}]`) would drop the very thing the agent asked for.
 *  Interactions keep their own note. */
export function stepNote(action: string, result?: VfCommandResult): string {
  if (result?.action === 'snapshot') {
    const s = result.snapshot
    return s ? `snapshot → ${s.stats.nodes} nodes (${s.stats.interactive} interactive)` : 'snapshot'
  }
  if (result?.action === 'evaluate') return `evaluate → ${result.value ?? 'undefined'}`
  if (result?.action === 'console') {
    const tail = (result.console ?? []).slice(-1)[0]
    return tail ? `console → [${tail.level}] ${tail.text}` : 'console → (empty)'
  }
  return result?.note ?? `${action} done`
}

/** Describe the failed step and the effects already applied by earlier steps. */
export function failedStep(
  steps: readonly { action: string }[],
  i: number,
  notes: string[],
  sub: ActuateResult,
): ActuateResult {
  // The earlier steps ALREADY RAN, and they mutate the page (a typed field, a
  // click). Reporting only "step 3 failed" invites the model to re-send the whole
  // batch, duplicating those side effects. Say what already happened — same rule
  // as bash's partial-batch summary: a result must disclose what it did.
  const done = notes.length
    ? `\nSteps 1-${i} already ran and their effects are on the page — do NOT repeat them: ${notes.join(' → ')}`
    : ''
  // Carry the failing step's fresh snapshot (from self-heal) up to the agent.
  return {
    ok: false,
    error: `step ${i + 1} (${steps[i].action}): ${sub.error}${done}`,
    errorCode: sub.errorCode,
    ...(sub.result?.snapshot ? { result: { action: 'steps', snapshot: sub.result.snapshot } } : {}),
  }
}
