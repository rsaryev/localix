/**
 * `planCheckpoint` — decide, without a model call, how a conversation that outgrew its window is
 * shown from now on: which whole turns leave the view (described by epoch cards) and how the
 * turns that stay are compressed, so that the result fits a target far enough below the ceiling
 * that the next checkpoint is many turns away. Hysteresis is the point: a view that is trimmed a
 * little on every turn rewrites the cached prefix and the thinking chain on every turn.
 *
 * The order of preference follows the evidence. First the recoverable I/O and old observations
 * (elide → truncate → pointer — observation masking, which a published study found as
 * effective as LLM summarization at half the cost), then the assistant's own long text (`fold`),
 * and only when the kept stretch still does not fit, whole turns from the oldest end. Evicting
 * first would throw away turns whose skeleton — what was asked, what was done — still fits.
 *
 * Validate → decide → build: the candidates are computed, one is chosen, the record is built.
 */
import type { ChatMessage } from '../../chat'
import { planContextCompression, type CompressionPlan } from '../plan'
import { operationFloorOf, type OperationFloor } from '../op-floor'
import { estimateChatMessageTokens } from '../tokens'
import { cardFacts, fitCards, renderCard, renderCardsRegion } from './epoch-card'
import {
  applyFrozenTransform,
  freezeTransform,
  stripReasoning,
  supersededSnapshots,
  type TransformFlags,
} from './transforms'
import type {
  CheckpointEntry,
  CheckpointReason,
  ContextCheckpoint,
  EpochCard,
  FrozenTransform,
} from './types'

export interface PlanCheckpointInput {
  /** The history after the last /clear, oldest first, ending with the active turn. */
  entries: readonly CheckpointEntry[]
  /** The checkpoint currently in force: its cards and transforms are only ever strengthened. */
  previous?: ContextCheckpoint
  reason: CheckpointReason
  /** Tokens the shown history may occupy after this checkpoint. */
  targetTokens: number
  /** Where the active turn starts: it, and everything after it, stays whole. */
  activeFromIndex: number
  /** The recent tail VBC keeps verbatim (count and token cap). */
  keepRecentCount: number
  keepRecentTokens: number
  /** Share of the target the card region may take. */
  cardBudgetTokens: number
  flags: TransformFlags
}

/** Re-plans with the estimate's drift fed back; two close all but pathological gaps. */
const DRIFT_PASSES = 2

interface Attempt {
  evictEnd: number
  cards: EpochCard[]
  transforms: Record<string, FrozenTransform>
  total: number
}

const tokensOf = (messages: readonly ChatMessage[]) =>
  messages.reduce((sum, message) => sum + estimateChatMessageTokens(message), 0)

/** Priced as the message the projection will build around it, not as bare text. */
const cardsTokens = (cards: readonly EpochCard[], recallToolAvailable: boolean) =>
  cards.length === 0
    ? 0
    : estimateChatMessageTokens({
        id: '',
        role: 'user',
        content: renderCardsRegion(cards, recallToolAvailable),
      })

/** Freeze every kept message's op — the record the projection will apply. */
function freezeAll(
  entries: readonly CheckpointEntry[],
  kept: readonly number[],
  plan: CompressionPlan,
  superseded: ReadonlyMap<string, string[]>,
): Record<string, FrozenTransform> {
  const transforms: Record<string, FrozenTransform> = {}
  kept.forEach((entryIndex, position) => {
    const { message } = entries[entryIndex]!
    const op = plan.assignment[position]!.op
    const transform = freezeTransform(message, op, plan, superseded.get(message.id))
    if (transform) transforms[message.id] = transform
  })
  return transforms
}

function floorOfTransform(transform: FrozenTransform): OperationFloor | undefined {
  const op = transform.op
  if (!op) return undefined
  return operationFloorOf({
    kind: op.kind,
    cost: 0,
    retention: 0,
    ...('truncateChars' in op && op.truncateChars !== undefined
      ? { truncateChars: op.truncateChars }
      : {}),
  })
}

export function planCheckpoint(input: PlanCheckpointInput): ContextCheckpoint {
  const { entries, previous, flags } = input
  const last = entries[entries.length - 1]
  if (!last) throw new Error('planCheckpoint needs at least one message')
  const indexOf = new Map(entries.map((entry, index) => [entry.message.id, index]))

  // ---- The view being priced: thinking cannot survive the rewrite, stale snapshots collapse.
  const superseded = supersededSnapshots(entries.map((entry) => entry.message))
  const shown = entries.map((entry) =>
    applyFrozenTransform(
      stripReasoning(entry.message),
      superseded.has(entry.message.id)
        ? { supersededItemIds: superseded.get(entry.message.id) }
        : undefined,
      flags,
    ),
  )
  const floors = new Map<string, OperationFloor>()
  for (const [id, transform] of Object.entries(previous?.transforms ?? {})) {
    const floor = floorOfTransform(transform)
    if (floor) floors.set(id, floor)
  }

  // ---- Candidates: cut only in front of a turn start, never un-evict, never evict the active turn.
  const previousEnd = previous?.evictedThroughId
    ? Math.max(0, indexOf.get(previous.evictedThroughId) ?? 0)
    : 0
  const activeFrom = Math.max(1, Math.min(input.activeFromIndex, entries.length))
  const candidates = [previousEnd]
  for (let start = previousEnd + 1; start <= activeFrom; start++) {
    if (start < entries.length && entries[start]!.turnStart && start - 1 > previousEnd) {
      candidates.push(start - 1)
    }
  }

  const factsFor = (fromId: string, throughId: string) => {
    const from = indexOf.get(fromId)
    const through = indexOf.get(throughId)
    return from === undefined || through === undefined || through < from
      ? undefined
      : cardFacts(entries.slice(from, through + 1))
  }
  const lockedAlways = new Set(entries.slice(activeFrom).map((entry) => entry.message.id))

  const attempts = new Map<number, Attempt>()
  const attempt = (evictEnd: number): Attempt => {
    const cached = attempts.get(evictEnd)
    if (cached) return cached
    const fresh = entries.slice(previousEnd + 1, evictEnd + 1)
    const cards = fitCards(
      [...(previous?.cards ?? []), ...(fresh.length > 0 ? [renderCard(cardFacts(fresh), 0)] : [])],
      input.cardBudgetTokens,
      flags.recallToolAvailable,
      factsFor,
    )
    const cardTokens = cardsTokens(cards, flags.recallToolAvailable)
    // A pin is shown exactly as it was said, so it is priced that way — thinking aside.
    const pinTokens = tokensOf(
      entries
        .slice(1, evictEnd + 1)
        .flatMap((entry) => (entry.pinned ? [stripReasoning(entry.message)] : [])),
    )
    // The first task always stays: it is what the whole conversation is for.
    const kept = [0]
    for (let i = evictEnd + 1; i < entries.length; i++) kept.push(i)
    const locked = new Set(lockedAlways)
    for (const i of kept) if (entries[i]!.pinned) locked.add(entries[i]!.message.id)
    const keptBudget = Math.max(0, input.targetTokens - cardTokens - pinTokens)
    const compress = (budget: number) => {
      const plan = planContextCompression(
        kept.map((i) => shown[i]!),
        {
          budget,
          keepRecentCount: input.keepRecentCount,
          keepRecentTokens: input.keepRecentTokens,
          protectFirstTask: true,
          boundaryQuantum: 1,
          lockedIds: locked,
          opFloor: new Map(floors),
        },
      )
      // Priced by the view the projection will actually build: the menu's costs are estimates
      // (a pointer's vocabulary hints are not in them), and a view that fits only by estimate
      // overflows the target it was chosen to meet.
      const transforms = freezeAll(entries, kept, plan, superseded)
      const tokens = kept.reduce(
        (sum, i) =>
          sum +
          estimateChatMessageTokens(
            applyFrozenTransform(
              stripReasoning(entries[i]!.message),
              transforms[entries[i]!.message.id],
              flags,
            ),
          ),
        0,
      )
      return { plan, transforms, tokens }
    }
    // The allocator stops as soon as its ESTIMATE fits, so feed the observed drift back — the
    // compress stage's rule — before concluding this cut needs more eviction than it does.
    let compressed = compress(keptBudget)
    for (let pass = 0; pass < DRIFT_PASSES && compressed.tokens > keptBudget; pass++) {
      const drift = compressed.tokens - compressed.plan.estTokensAfter
      if (drift <= 0) break
      compressed = compress(Math.max(0, keptBudget - drift))
    }
    const result = {
      evictEnd,
      cards,
      transforms: compressed.transforms,
      total: compressed.tokens + cardTokens + pinTokens,
    }
    attempts.set(evictEnd, result)
    return result
  }

  // ---- Decide: the least eviction that fits (evicting more only ever shrinks the view).
  let low = 0
  let high = candidates.length - 1
  let chosen = attempt(candidates[high]!)
  while (low <= high) {
    const middle = (low + high) >> 1
    const candidate = attempt(candidates[middle]!)
    if (candidate.total <= input.targetTokens) {
      chosen = candidate
      high = middle - 1
    } else {
      low = middle + 1
    }
  }

  // ---- Build the record the projection will apply on every turn until the next checkpoint.
  const evictedThrough = chosen.evictEnd > 0 ? entries[chosen.evictEnd]!.message.id : undefined
  return {
    version: 1,
    reason: input.reason,
    coversThroughId: last.message.id,
    ...(evictedThrough ? { evictedThroughId: evictedThrough } : {}),
    cards: chosen.cards,
    transforms: chosen.transforms,
    pinnedIds: entries
      .slice(1, chosen.evictEnd + 1)
      .flatMap((entry) => (entry.pinned ? [entry.message.id] : [])),
    recoveryToolAvailable: flags.recoveryToolAvailable,
    recallToolAvailable: flags.recallToolAvailable,
    tokens: {
      before: tokensOf(entries.map((entry) => entry.message)),
      after: chosen.total,
      target: input.targetTokens,
    },
  }
}
