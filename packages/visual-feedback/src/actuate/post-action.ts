import type { ActuateDeps } from './types'
import { settleCommit, settleTransitions } from './settle'
import { stateForDiff, diffTrees } from './diff'
import { buildSnapshot } from '../snapshot/index'

async function afterAction(deps: ActuateDeps): Promise<string | undefined> {
  // Wait for the page to SETTLE before resampling the document-state signature.
  // Two reasons: (1) framework state commits asynchronously; (2) — the
  // root cause — a CSS `transition` on the restyled property means getComputedStyle
  // returns an INTERPOLATED value: sampled synchronously right after the click it is
  // still the OLD color, so the diff falsely reports "(no visible change)" for a
  // theme toggle that IS working. Settling until the transition finishes makes the
  // color resample accurate. The interactive tree is captured in the same post-settle
  // sample (settled is a superset of committed).
  const settle = deps.settle ?? settleTransitions
  await settle()
  const next = stateForDiff(deps.root)
  const diff = diffTrees(deps.prevTree.value, next)
  deps.prevTree.value = next
  return diff
}

/** Cap on error/warn lines attached to one action result, and their per-line length —
 *  a noisy page must not flood the model's context. */
const MAX_RECENT_ERRORS = 3
const RECENT_ERROR_MAX_LEN = 200

/**
 * Error/warn console entries — including uncaught exceptions, unhandled rejections, and
 * auto-dismissed dialogs (all recorded at level error/warn by the console capture) — that
 * arrived since `sinceCursor`, bounded + truncated. Read AFTER settle so a late async
 * error within the settle window is caught too. `undefined` when the action was clean.
 */
function collectRecentErrors(deps: ActuateDeps, sinceCursor: number): string[] | undefined {
  const entries = deps.console
    .read(sinceCursor)
    .filter((e) => e.level === 'error' || e.level === 'warn')
  if (!entries.length) return undefined
  return entries
    .slice(-MAX_RECENT_ERRORS)
    .map((e) =>
      e.text.length > RECENT_ERROR_MAX_LEN
        ? `${e.text.slice(0, RECENT_ERROR_MAX_LEN - 1)}…`
        : e.text,
    )
}

/**
 * Result fields to attach after a state-changing action: always the settled
 * interactive+state diff, plus — when `snapshotAfter` — a fresh full snapshot of the
 * resulting page (repopulating `deps.reg` with new refs). `afterAction` settles
 * FIRST, so both the diff AND the snapshot reflect the POST-action, post-transition
 * DOM rather than a mid-update / mid-animation frame — AND so `recentErrors` (read
 * here, gated on the pre-action `sinceConsoleCursor`) captures errors thrown late in
 * the settle window, not just synchronously during dispatch.
 */
export async function postAction(
  deps: ActuateDeps,
  snapshotAfter?: boolean,
  sinceConsoleCursor?: number,
): Promise<{
  diff?: string
  snapshot?: ReturnType<typeof buildSnapshot>
  recentErrors?: string[]
}> {
  // A batch member: its diff would be discarded, and the full settle is what made a batch
  // cost ~1s per key. The batch's own postAction settles and diffs everything at once.
  if (deps.inBatch) {
    await settleCommit()
    return {}
  }
  const diff = await afterAction(deps)
  const recentErrors =
    sinceConsoleCursor == null ? undefined : collectRecentErrors(deps, sinceConsoleCursor)
  const base = snapshotAfter
    ? { diff, snapshot: buildSnapshot(deps.reg, { root: deps.root }) }
    : { diff }
  return recentErrors ? { ...base, recentErrors } : base
}
