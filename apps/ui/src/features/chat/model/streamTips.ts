import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerTip, TipSignal } from '@/shared/api/tips'
import {
  bumpSeenCount,
  pickWithRecycle,
  shouldSwapForMoment,
  topSpecificity,
  type TipContext,
} from './tipSelection'

/**
 * WHEN the composer's waiting band speaks: the clock, and the one interruption.
 *
 * Which tip it shows is `tipSelection.ts`; what a tip says is the server's. This
 * module owns only the pacing, and the pacing is the part users feel:
 *
 * - Nothing for {@link SHOW_DELAY_MS}, so a quick reply never flashes a tip on its way
 *   past.
 * - Then one tip per {@link ROTATE_MS}.
 * - Between ticks the band still reacts when the MOMENT outruns what is on screen — a
 *   tool starts streaming, the context fills, a message queues — because a tip about what
 *   is happening is worthless a rotation later. Only a more specific tip interrupts,
 *   and never inside `MIN_ON_SCREEN_MS`.
 *
 * Everything resets when the run ends.
 */

/**
 * Don't show anything during the first seconds — short answers need no tip.
 *
 * Long enough that a quick reply never flashes a tip on its way past, short enough
 * that a run you are actually waiting on says something almost at once.
 */
const SHOW_DELAY_MS = 2000
/**
 * How long each tip stays before rotating to the next one.
 *
 * A tip is one short sentence; fifteen seconds of it was a strip that felt frozen
 * while the run scrolled underneath. This is the pace of ambient copy — read it,
 * ignore it, and the next one is already different.
 */
const ROTATE_MS = 7000
/**
 * When a run becomes a WAIT, and the `run-long` signal starts holding.
 *
 * This one signal is resolved here rather than in `useTipSignals` because it is a
 * fact about the run this hook is already timing — asking the store for it would
 * mean a second clock that can disagree with the one deciding when tips rotate.
 */
const RUN_LONG_MS = 45000

/**
 * Drives the composer tip band. Returns the current tip (null when none should
 * show) and a dismiss callback that hides tips until the next run.
 */
export function useStreamTip(isGenerating: boolean, ctx: TipContext, tips: readonly ComposerTip[]) {
  const [tip, setTip] = useState<ComposerTip | null>(null)
  const [dismissed, setDismissed] = useState(false)
  // Context and the pool flow through refs so token-by-token updates and snapshot
  // refreshes never restart timers.
  const ctxRef = useRef(ctx)
  const tipsRef = useRef(tips)
  useEffect(() => {
    ctxRef.current = ctx
  }, [ctx])
  useEffect(() => {
    tipsRef.current = tips
  }, [tips])
  const shownThisRun = useRef<Set<string>>(new Set())
  // What is on screen and since when — read by the reaction below, which must not
  // replace a sentence nobody has had time to finish.
  const shownTip = useRef<ComposerTip | null>(null)
  const shownAt = useRef(0)
  // Held so a reaction can restart the cadence from the tip it just put up, instead of
  // letting the old interval cut it short.
  const rotateTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const runStart = useRef(0)

  /** Pick and show, stamping what went up so the reaction can time itself. */
  const showNext = useCallback(() => {
    const current = ctxRef.current
    const ctxNow =
      Date.now() - runStart.current >= RUN_LONG_MS
        ? { ...current, signals: new Set<TipSignal>([...current.signals, 'run-long']) }
        : current
    const next = pickWithRecycle(ctxNow, shownThisRun.current, tipsRef.current)
    if (next) {
      shownThisRun.current.add(next.id)
      bumpSeenCount(next.id)
    }
    shownTip.current = next
    shownAt.current = Date.now()
    setTip(next)
  }, [])

  const restartRotation = useCallback(() => {
    if (rotateTimer.current) clearInterval(rotateTimer.current)
    rotateTimer.current = setInterval(showNext, ROTATE_MS)
  }, [showNext])

  useEffect(() => {
    if (!isGenerating) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on run end
      setTip(null)
      setDismissed(false)
      shownThisRun.current.clear()
      shownTip.current = null
      return
    }
    runStart.current = Date.now()
    const delayTimer = setTimeout(() => {
      showNext()
      restartRotation()
    }, SHOW_DELAY_MS)
    return () => {
      clearTimeout(delayTimer)
      if (rotateTimer.current) clearInterval(rotateTimer.current)
      rotateTimer.current = null
    }
  }, [isGenerating, showNext, restartRotation])

  /**
   * React to the MOMENT, not only to the clock.
   *
   * A tool starts streaming, the context fills, a message queues — and the band goes on
   * showing whatever the last tick chose, for up to a full rotation. Since a gate's
   * specificity is what ranks tips, "something better now applies" is a comparison, not
   * a guess: swap only when the best eligible tip is MORE specific than the one up,
   * which is exactly when the moment has outrun it.
   *
   * The interval is re-armed rather than left alone, so the tip just shown gets its
   * whole turn instead of inheriting the remainder of the previous one.
   */
  const moment = `${ctx.activeToolName ?? ''}|${[...ctx.signals].sort().join(',')}`
  useEffect(() => {
    if (!isGenerating) return
    const best = topSpecificity(ctxRef.current, shownThisRun.current, tipsRef.current)
    if (!shouldSwapForMoment(shownTip.current, best, Date.now() - shownAt.current)) return
    showNext()
    restartRotation()
  }, [moment, isGenerating, showNext, restartRotation])

  const dismiss = useCallback(() => {
    shownTip.current?.onDismiss?.()
    setDismissed(true)
  }, [])

  // A local settings tip disappears immediately after its action or eligibility
  // changes, rather than leaving an obsolete invitation up until the next tick.
  const visible =
    tip && tips.some((candidate) => candidate.id === tip.id) && (tip.eligible?.() ?? true)
  return { tip: dismissed || !visible ? null : tip, dismiss }
}
