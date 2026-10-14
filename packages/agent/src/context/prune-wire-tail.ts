import type { Message } from '../types'
import { quantizeBoundaryStart } from './boundary'
import type { PruneWireOptions } from './prune-wire-options'

interface ProtectedTailInput {
  messages: Message[]
  opts: PruneWireOptions
  estTokens: (message: Message, index: number) => number
  cap: number
  minKeep: number
  /** Captured before estimator callbacks run; never re-derived from a mutable history. */
  N: number
  budget: number
  overBudget: boolean
}

export function protectWireTail({
  messages,
  opts,
  estTokens,
  cap,
  minKeep,
  N,
  budget,
  overBudget,
}: ProtectedTailInput): { locked: boolean[]; tailStart: number } {
  // Lock the recent tail (token-capped, with a minimum count) + the first message.
  //
  // EMERGENCY TAIL SHRINK. `budgetTokens` is documented as a HARD ceiling — "a history above
  // it must be crushed however comfortable the gate thinks it is" — but the tail protection
  // silently outranked it: with a tail fatter than the budget, EVERY message was locked, so
  // eliding had nothing left to reclaim and the history went out verbatim. Measured at the
  // default `keepRecentTokens`: 14 393 tokens returned against a 3 598 budget, unchanged.
  //
  // So when the request does not fit, the tail cap shrinks to what the budget can actually
  // afford. It is a LAST RESORT, and deliberately bounded three ways:
  //   - it only ever applies `overBudget`, which is the case that is otherwise a guaranteed
  //     provider rejection — a smaller protected tail beats losing the whole turn;
  //   - `minKeep` still protects the newest messages BY COUNT, so the active turn survives
  //     no matter how small the budget is (a budget that cannot hold those is a model the
  //     turn cannot run on at all, which is `ActiveTurnTooLargeError`'s job to say);
  //   - the ratchet and the live-read exemptions are untouched: this changes which messages
  //     are eligible for elision, not what eliding does to them. Note `liveReadBudgetBytes`
  //     is still scaled from the ORIGINAL `cap`, not from the shrunken tail — the last
  //     un-superseded read stays protected wherever it sits, which is the whole point of
  //     that separate protection.
  // WHEN IT ARMS, measured with the real helpers rather than asserted: the tail is ~17% of the
  // budget at 128k-1M declared windows (a 200k model: 30 000 against 180 000), so it is dormant
  // there. It arms on every over-budget request BELOW roughly a 45k window, where
  // `keepRecentTokens`' 16 384 floor is a large share of the trigger (at 16 384 the tail cap
  // becomes 6 008 — the whole affordable request). An earlier version of this comment claimed
  // "dormant on the common path" without that qualifier; a review measured the small-window
  // case and it is not dormant there at all.
  //
  // TWO COSTS, both real, neither hidden: (1) the result may STILL exceed the budget — the
  // count floor plus live-read-protected content are not reclaimable, and at `budgetTokens: 1`
  // the measured output is 6 199 tokens; (2) over budget the boundary quantum collapses to 1
  // (below), so a shrinking tail moves the protected boundary on every request and churns the
  // prompt-cache prefix instead of holding a stable one. That trade only applies to a request
  // that would otherwise be rejected outright, and a prune asks the host for a context
  // checkpoint at the next run start, so the churn is bounded to one run's tool loop.
  const affordableTail = overBudget ? Math.max(0, budget - (opts.fixedOverheadTokens ?? 0)) : cap
  const tailCap = Math.min(cap, affordableTail)
  const locked = Array.from({ length: N }, () => false)
  if (N > 0) locked[0] = true
  let tail = 0
  let tailStart = N
  for (let i = N - 1; i >= 0; i--) {
    const within = N - 1 - i < minKeep
    const messageTokens = estTokens(messages[i], i)
    // Under the hard ceiling, the optional tail is a budget rather than the usual approximate
    // window. A large result that does not fit must stay eligible for pointering instead of
    // pushing the protected region over the ceiling by its whole size.
    if (!within && (overBudget ? tail + messageTokens > tailCap : tail > tailCap)) break
    locked[i] = true
    tailStart = i
    tail += messageTokens
  }
  // Quantize the boundary DOWN to a multiple of the quantum so consecutive
  // requests share an identical pruned prefix (prompt-cache friendly). Only
  // ever ADDS protected messages — never fewer than the un-quantized window.
  // Over budget that trade inverts: protecting extra messages for cache stability
  // cannot outrank fitting in the window, so the quantum collapses to 1.
  const quantum = overBudget ? 1 : opts.boundaryQuantum
  for (let i = quantizeBoundaryStart(tailStart, quantum); i < tailStart; i++) locked[i] = true

  return { locked, tailStart }
}
