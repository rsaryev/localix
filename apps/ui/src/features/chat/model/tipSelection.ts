import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import type { ComposerTip, ComposerTipGate, TipSignal } from '@/shared/api/tips'

/**
 * WHICH tip, of the ones the server sent, applies right now — the whole selection
 * rule, with no React and no clock. `streamTips.ts` owns the timing and calls this.
 *
 * What a tip SAYS is not decided here either. The pool arrives with the capability
 * snapshot, composed from the scope's own plugins, tools and skills, because that is
 * the only place those are known — the client once held the sentences too, and paid
 * for it by naming three plugins and four tool names in a file that ships to every
 * workspace, whether or not those plugins exist in it.
 *
 * Selection model — the MOST SPECIFIC match wins:
 * - A tip's `when` gate is a set of conditions (the last user message, the streaming
 *   tool, named facts about the live session). All must hold for the tip to be
 *   eligible at all.
 * - Among eligible tips, the one naming MORE of the moment beats the one naming less:
 *   a tip gated on "the context is nearly full" outranks a generic product line, and
 *   a generic line only shows when nothing more specific applies. That is what lets
 *   the pool grow — a tip that can only appear in its own moment costs nothing at
 *   every other moment.
 * - Within one specificity tier the pick is weighted-random by 1/(1+timesSeen) —
 *   times-seen persists in localStorage, so over days every tip gets airtime and the
 *   ones seen a lot fade out. A tip never repeats within one run.
 */
export interface TipContext {
  /** Latest user message in the active session ('' when none). */
  userText: string
  /** Name of the tool currently streaming, if any. */
  activeToolName: string | null
  /**
   * The named session facts that hold right now (see `TIP_SIGNALS` and
   * `useTipSignals`). The client answers this vocabulary; it does not define it.
   */
  signals: ReadonlySet<TipSignal>
}

/**
 * The floor under a tip's time on screen.
 *
 * The band reacts to the moment between rotations, and without a floor a run that
 * flips between tools would swap the sentence mid-read. Nothing is replaced before it
 * can be finished — the reaction waits out the remainder instead.
 */
export const MIN_ON_SCREEN_MS = 2500

/**
 * Compiled `textPattern`s, keyed by their source.
 *
 * The gate is tested on every rotation against a pattern that came over the wire, and
 * a `RegExp` built per test would recompile the same source all session. Keyed by the
 * source rather than the tip id so two tips sharing a pattern share the compilation.
 */
const patternCache = new Map<string, RegExp | null>()

function compile(source: string): RegExp | null {
  const cached = patternCache.get(source)
  if (cached !== undefined) return cached
  let compiled: RegExp | null = null
  try {
    compiled = new RegExp(source, 'i')
  } catch {
    // A pattern the client cannot compile is a gate it cannot honour. Remember the
    // failure so the tip is treated as permanently non-matching (see `matchesGate`)
    // instead of quietly becoming a generic tip that shows up everywhere.
    compiled = null
  }
  patternCache.set(source, compiled)
  return compiled
}

/**
 * Evaluate a server-sent gate WITHOUT interpreting it: a regexp against the text, a
 * name against the streaming tool, names against the live session facts. Every
 * condition present must hold.
 */
export function matchesGate(gate: ComposerTipGate, ctx: TipContext): boolean {
  if (gate.textPattern) {
    const pattern = compile(gate.textPattern)
    if (!pattern || !pattern.test(ctx.userText)) return false
  }
  if (gate.tools && gate.tools.length > 0) {
    if (!ctx.activeToolName || !gate.tools.includes(ctx.activeToolName)) return false
  }
  if (gate.signals?.some((signal) => !ctx.signals.has(signal))) return false
  if (gate.notSignals?.some((signal) => ctx.signals.has(signal))) return false
  return true
}

/**
 * How much of the moment a gate names — the rank that decides which eligible tip
 * shows.
 *
 * Counting conditions rather than sorting by hand keeps the ordering a property of
 * the data: a tip added tomorrow with two conditions outranks the generic pool
 * without anyone editing a priority list, and the pool can grow without the specific
 * tips losing airtime to it.
 */
export function gateSpecificity(tip: ComposerTip): number {
  const gate = tip.when
  if (!gate) return 0
  return (
    (gate.textPattern ? 1 : 0) +
    (gate.tools?.length ? 1 : 0) +
    (gate.signals?.length ?? 0) +
    (gate.notSignals?.length ?? 0)
  )
}

const SEEN_STORAGE_KEY = 'localix_tip_seen'

function loadSeenCounts(): Record<string, number> {
  return loadJSON<Record<string, number>>(SEEN_STORAGE_KEY) ?? {}
}

export function bumpSeenCount(id: string): void {
  // private mode etc. — saveJSON no-ops, so tips just won't deprioritize
  const counts = loadSeenCounts()
  counts[id] = (counts[id] ?? 0) + 1
  saveJSON(SEEN_STORAGE_KEY, counts)
}

/** The tips whose gate holds right now, minus the ones already shown this run. */
function eligibleTips(
  ctx: TipContext,
  exclude: ReadonlySet<string>,
  tips: readonly ComposerTip[],
): ComposerTip[] {
  return tips.filter(
    (t) => !exclude.has(t.id) && (t.eligible?.() ?? true) && (!t.when || matchesGate(t.when, ctx)),
  )
}

/**
 * How specific the best available tip is, or `null` when none is eligible.
 *
 * Read by the hook to decide whether the MOMENT has outrun the tip on screen: a tool
 * started streaming, the context filled up, a message queued. Waiting out the rotation
 * interval before saying something about it is the difference between a tip that reads
 * as ambient and one that reads as attentive.
 */
export function topSpecificity(
  ctx: TipContext,
  exclude: ReadonlySet<string>,
  tips: readonly ComposerTip[],
): number | null {
  const eligible = eligibleTips(ctx, exclude, tips)
  return eligible.length === 0 ? null : Math.max(...eligible.map(gateSpecificity))
}

/**
 * Should the band replace what is on screen because the moment moved on?
 *
 * Pure, and separate from the effect that calls it, because this is the whole rule the
 * reactive swap rests on: only a MORE specific tip interrupts, and nothing interrupts a
 * sentence that has not been up long enough to read.
 */
export function shouldSwapForMoment(
  shown: ComposerTip | null,
  bestAvailable: number | null,
  sinceShownMs: number,
): boolean {
  if (shown === null || sinceShownMs < MIN_ON_SCREEN_MS) return false
  return bestAvailable !== null && bestAvailable > gateSpecificity(shown)
}

export function pickStreamTip(
  ctx: TipContext,
  exclude: ReadonlySet<string>,
  tips: readonly ComposerTip[],
): ComposerTip | null {
  const eligible = eligibleTips(ctx, exclude, tips)
  if (eligible.length === 0) return null
  // Only the most specific tier competes; everything vaguer is a fallback for a
  // moment that has nothing better to say.
  const top = Math.max(...eligible.map(gateSpecificity))
  const pool = eligible.filter((t) => gateSpecificity(t) === top)

  const seen = loadSeenCounts()
  const weights = pool.map((t) => 1 / (1 + (seen[t.id] ?? 0)))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = Math.random() * total
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/**
 * Pick, and start the run's list over rather than going silent.
 *
 * A tip never repeats within a run, so a long run eventually exhausts what is eligible
 * — and at this cadence that is minutes, not an hour. Going quiet for the rest of a
 * twenty-minute run is worse than showing a good tip twice, so the run's shown-set is
 * cleared and the pick runs again. The localStorage seen-counts are untouched, so the
 * second pass is still weighted away from what the user has read most.
 *
 * Mutates `shown` — it is the run's bookkeeping, owned by the caller that passes it.
 */
export function pickWithRecycle(
  ctx: TipContext,
  shown: Set<string>,
  tips: readonly ComposerTip[],
): ComposerTip | null {
  const next = pickStreamTip(ctx, shown, tips)
  if (next || shown.size === 0) return next
  shown.clear()
  return pickStreamTip(ctx, shown, tips)
}
