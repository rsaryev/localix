/**
 * The actuation dispatcher's contract — the deps one command needs, and the result it
 * returns. Its own leaf so `target.ts` can take `ActuateDeps` without importing the
 * dispatcher that consumes it.
 */
import type { VfCommandErrorCode, VfCommandResult } from '../protocol/index'
import type { RefRegistry } from '../snapshot/index'
import type { ConsoleCapture } from './console-capture'

/* ------------------------------- dispatcher ------------------------------- */

export interface ActuateDeps {
  reg: RefRegistry
  console: ConsoleCapture
  /**
   * The subtree the command runs against. Omitted in a probe, where the page IS the target. A
   * host that runs the actuator against one of its OWN panels sets it, so a snapshot lists only
   * that panel, a selector cannot land on a control of the surrounding app, and a screenshot
   * without a target is the panel, not the whole window.
   */
  root?: Element
  /**
   * The JPEG backdrop for a screenshot. Omitted, the rasterizer takes the first opaque paint
   * under the target — which a host whose window is translucent (macOS glass) does not have, so
   * its panels would photograph on white.
   */
  backdrop?: string
  /** Interactive-only tree from the last snapshot/action, for diffing. Mutated in place. */
  prevTree: { value: string }
  /** Settle strategy awaited before the post-action doc-state resample (colors are
   *  interpolated mid-CSS-transition). Injectable for tests; defaults to
   *  `settleTransitions` (2 rAFs + bounded wait for html/body animations to finish). */
  settle?: () => Promise<void>
  /** Set by `steps` for its members: wait only for the commit, skip the diff. The batch
   *  settles and diffs once at its end (see `steps-settle.test.ts` for why). */
  inBatch?: boolean
}

export interface ActuateResult {
  ok: boolean
  result?: VfCommandResult
  error?: string
  errorCode?: VfCommandErrorCode
}
