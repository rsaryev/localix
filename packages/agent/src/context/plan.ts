/**
 * `planContextCompression` — the pure (no-LLM) entry point for VBC. Produces a
 * per-message operation assignment that fits a token budget while minimizing
 * task-value loss: extract entities → build dependency/supersession graph → score
 * value → build downgrade menus → lock hard-keep messages → greedily allocate.
 */
import type { ChatMessage } from '../chat'
import { buildDepGraph } from './dep-graph'
import { scoreMessages, DEFAULT_VALUE_WEIGHTS, type ValueWeights } from './value'
import { operationMenu, type Operation, type OpMenuOptions } from './op-menu'
import {
  operationFloorOf,
  operationIndexForFloor,
  strongestOperationFloor,
  type OperationFloor,
} from './op-floor'
import { allocate } from './allocator'
import { estimateChatMessageTokens } from './tokens'
import { quantizeBoundaryStart } from './boundary'
import type { ResolveTarget } from './targets'
import { classifyReads, type LiveReadOptions, type ReadFate } from './live-reads'

export interface CompressionPlan {
  /** Items `applyPlan` must leave verbatim under every op (the live reads). */
  protectedItemIds?: ReadonlySet<string>
  /** How each elided read must be recovered — drives which pointer `applyPlan` writes. */
  readFates?: ReadonlyMap<string, ReadFate>
  /** Chosen operation for every message, by index. */
  assignment: Array<{ index: number; op: Operation }>
  estTokensBefore: number
  estTokensAfter: number
  budget: number
}

export interface PlanOptions {
  /**
   * Token budget the compressed context must fit under. `Infinity` ⇒ no-op.
   *
   * A finite budget drains every `lossless` (elide-to-pointer) downgrade. "Lossless" means
   * RECOVERABLE, not free — recovery costs the model a round-trip or a re-read — so a plan
   * must only be asked for under real pressure. The host does: it plans only when a context
   * checkpoint is due, never on an ordinary turn.
   */
  budget: number
  /** Max number of most-recent messages kept verbatim (hard-keep tail). */
  keepRecentCount: number
  /**
   * Token cap on the hard-keep tail: stop locking recent messages once their
   * cumulative cost would exceed this (keeping ≥1), so a few huge recent writes
   * don't balloon the protected window past the budget. Default: no cap.
   */
  keepRecentTokens?: number
  /** Keep the first message verbatim (original task). Default true. */
  protectFirstTask?: boolean
  /**
   * Messages that stay verbatim wherever they sit — the person's pins, the active turn. Locked
   * like the first task and the recent tail, so the allocator never spends them to meet the
   * budget.
   */
  lockedIds?: ReadonlySet<string>
  /**
   * Quantize the verbatim/elided boundary: round the hard-keep tail's start
   * index DOWN to a multiple of this many messages, so consecutive plans share
   * an identical elided prefix (prompt-cache friendly) instead of sliding the
   * boundary by one per new message. May protect up to `boundaryQuantum − 1`
   * extra messages; never protects fewer than the un-quantized window.
   * Default 8; `1` disables quantization.
   */
  boundaryQuantum?: number
  weights?: ValueWeights
  resolveTarget?: ResolveTarget
  opMenu?: OpMenuOptions
  /** Bounds on which read results survive compression untouched. See `live-reads.ts`. */
  liveReads?: LiveReadOptions
  /** supersededScore above this marks a message's tool output as near-lossless to drop. Default 0.1. */
  supersededThreshold?: number
  /**
   * Cross-run monotonicity memory: message id → the strongest semantic operation
   * ever chosen for it. When set, a non-locked message never receives a
   * LIGHTER op than its recorded floor. Without it, the greedy allocator
   * re-ranks as recency shifts with every appended message, and under a BINDING
   * budget a previously-truncated old bash dump can bounce back to verbatim —
   * re-billing its full body every following request and breaking the
   * provider's prefix cache from that point (measured offline).
   * The map is read AND updated in place; the caller owns its lifetime (one map
   * per session) and may sweep ids that left the history.
   */
  opFloor?: Map<string, OperationFloor>
}

export function planContextCompression(
  messages: ChatMessage[],
  opts: PlanOptions,
): CompressionPlan {
  const N = messages.length
  const weights = opts.weights ?? DEFAULT_VALUE_WEIGHTS
  const protectFirst = opts.protectFirstTask ?? true
  const supThreshold = opts.supersededThreshold ?? 0.1

  const graph = buildDepGraph(messages, {
    recencyHalfLife: weights.recencyHalfLife,
    resolveTarget: opts.resolveTarget,
  })
  const values = scoreMessages(messages, graph, weights)

  // The last un-superseded read of each file is the model's only copy of it: exempt
  // those items from every op. VBC's granularity is the MESSAGE (a whole agent run),
  // so without this one `elide` collapses a run's every read at once — including the
  // read of the file the next tool call is about to patch.
  // Budget them against the protected tail, exactly as the wire layer does: the live
  // working set may never cost more than the recent window it complements.
  const liveBudgetBytes = opts.keepRecentTokens ? opts.keepRecentTokens * 4 : undefined
  const { live: protectedItemIds, fates: readFates } = classifyReads(messages, {
    ...(liveBudgetBytes ? { budgetBytes: liveBudgetBytes } : {}),
    ...opts.liveReads,
    resolveTarget: opts.resolveTarget,
  })
  const menus: Operation[][] = messages.map((m, i) =>
    operationMenu(m, graph.supersededScore(i) >= supThreshold, {
      ...opts.opMenu,
      protectedItemIds,
    }),
  )

  // Hard-keep the first message + a recent tail, bounded by BOTH a message count
  // and (optionally) a token cap — so the protected window can't exceed the budget.
  const locked = new Set<number>()
  if (protectFirst && N > 0) locked.add(0)
  const tokenCap = opts.keepRecentTokens ?? Number.POSITIVE_INFINITY
  let tailTokens = 0
  let tailCount = 0
  let tailStart = N
  for (let i = N - 1; i >= 0 && tailCount < opts.keepRecentCount; i--) {
    if (locked.has(i)) continue
    const t = estimateChatMessageTokens(messages[i])
    // A single oversized assistant row can contain an entire tool-heavy turn.
    // Locking "at least one" made that row exempt from every VBC operation even
    // when it alone exceeded the model budget. A runtime that stores tool calls and
    // results as separate session entries could cut inside such a turn; our persisted
    // row aggregates them in `items`, so the safe equivalent is to leave the row
    // UNLOCKED and let pairing-safe item rewrites bound it on the wire.
    if (tailTokens + t > tokenCap) break
    locked.add(i)
    tailStart = i
    tailTokens += t
    tailCount++
  }
  // Quantize the boundary DOWN to a multiple of the quantum so consecutive plans
  // share an identical verbatim/elided prefix (prompt-cache friendly). Only ever
  // ADDS locked messages — never protects fewer than the un-quantized window.
  for (let i = quantizeBoundaryStart(tailStart, opts.boundaryQuantum); i < tailStart; i++)
    locked.add(i)
  if (opts.lockedIds?.size) {
    for (let i = 0; i < N; i++) if (opts.lockedIds.has(messages[i].id)) locked.add(i)
  }

  // An infinite budget carries no window information at all ⇒ documented no-op.
  const opIndex = allocate(menus, values, opts.budget, locked, Number.isFinite(opts.budget))

  // Monotonicity floor (see PlanOptions.opFloor): never assign a non-locked
  // message a lighter op than it has ever received. Locked (first/tail) messages
  // are exempt — a message re-entering the protected tail after the history shrank is
  // MEANT to come back verbatim.
  if (opts.opFloor) {
    for (let i = 0; i < N; i++) {
      if (locked.has(i)) continue
      const id = messages[i].id
      if (!id) continue
      const floor = opts.opFloor.get(id)
      const floorIndex = floor ? operationIndexForFloor(menus[i], floor) : undefined
      if (floorIndex !== undefined && floorIndex > opIndex[i]) opIndex[i] = floorIndex

      const selectedFloor = operationFloorOf(menus[i][opIndex[i]])
      const strongest = strongestOperationFloor(floor, selectedFloor)
      if (strongest) opts.opFloor.set(id, strongest)
    }
  }

  const assignment = opIndex.map((idx, i) => ({ index: i, op: menus[i][idx] }))
  const estTokensBefore = menus.reduce((s, menu) => s + menu[0].cost, 0)
  const estTokensAfter = assignment.reduce((s, a) => s + a.op.cost, 0)

  return {
    assignment,
    estTokensBefore,
    estTokensAfter,
    budget: opts.budget,
    protectedItemIds,
    readFates,
  }
}
