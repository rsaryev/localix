import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { ComposerTip, TipSignal } from '@/shared/api/tips'
import {
  bumpSeenCount,
  pickWithRecycle,
  shouldSwapForMoment,
  topSpecificity,
  type TipContext,
} from './tipSelection'

/**
 * WHEN the composer's tip band speaks: the clock, and the one interruption.
 *
 * Which tip it shows is `tipSelection.ts`; what a tip says is the server's. This
 * module owns only the pacing, and the pacing is the part users feel:
 *
 * - The band is up whenever the composer in focus can show it, between turns too, so it
 *   never blinks in and out.
 * - ONE band per window, not one per composer: switching chats mounts another composer,
 *   and it shows the tip already on screen, on the same clock. A band owned by each
 *   composer started from nothing on every switch — empty, then a tip a moment later.
 * - One tip per {@link ROTATE_MS}.
 * - Between ticks the band still reacts when the MOMENT outruns what is on screen — a
 *   tool starts streaming, the context fills, a message queues — because a tip about what
 *   is happening is worthless a rotation later. Only a more specific tip interrupts,
 *   and never inside `MIN_ON_SCREEN_MS`.
 *
 * Hiding the band lasts until the next run starts.
 */

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

/** The window's band: what is on screen, since when, and what this run has shown. */
interface TipBand {
  tip: ComposerTip | null
  shownAt: number
  dismissed: boolean
}

let band: TipBand = { tip: null, shownAt: 0, dismissed: false }
const shownThisRun = new Set<string>()
const listeners = new Set<() => void>()

function setBand(next: Partial<TipBand>) {
  band = { ...band, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

const readBand = () => band

/** Test seam: an empty band, as at launch. */
export function __resetTipBand(): void {
  band = { tip: null, shownAt: 0, dismissed: false }
  shownThisRun.clear()
}

/**
 * Drives the composer tip band. `active` says this composer shows the band (it is the one
 * in focus); `isGenerating` marks a run, which times `run-long` and brings back a hidden
 * band. Returns the current tip (null when none should show) and a dismiss callback that
 * hides tips until the next run.
 */
export function useStreamTip(
  active: boolean,
  ctx: TipContext,
  tips: readonly ComposerTip[],
  isGenerating = active,
) {
  const { tip, dismissed } = useSyncExternalStore(subscribe, readBand, readBand)
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
  // Held so a reaction can restart the cadence from the tip it just put up, instead of
  // letting the old interval cut it short.
  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runStart = useRef(0)

  /** Pick and show, stamping what went up so the reaction can time itself. */
  const showNext = useCallback(() => {
    const current = ctxRef.current
    const ctxNow =
      runStart.current > 0 && Date.now() - runStart.current >= RUN_LONG_MS
        ? { ...current, signals: new Set<TipSignal>([...current.signals, 'run-long']) }
        : current
    const next = pickWithRecycle(ctxNow, shownThisRun, tipsRef.current)
    if (next) {
      shownThisRun.add(next.id)
      bumpSeenCount(next.id)
    }
    setBand({ tip: next, shownAt: Date.now() })
  }, [])

  /** Rotate when the tip on screen has had its turn: counted from when it went up, not from now. */
  const scheduleRotation = useCallback(() => {
    if (rotateTimer.current) clearTimeout(rotateTimer.current)
    const due = band.tip ? Math.max(0, band.shownAt + ROTATE_MS - Date.now()) : 0
    rotateTimer.current = setTimeout(function tick() {
      showNext()
      rotateTimer.current = setTimeout(tick, ROTATE_MS)
    }, due)
  }, [showNext])

  // A new run times `run-long` from its start and brings a hidden band back.
  useEffect(() => {
    runStart.current = isGenerating ? Date.now() : 0
    if (isGenerating) {
      shownThisRun.clear()
      if (band.dismissed) setBand({ dismissed: false })
    }
  }, [isGenerating])

  useEffect(() => {
    if (!active) return
    // The tip already up stays; a band with nothing on it (first launch, or the tip left the
    // pool) speaks at once.
    const current = band.tip
    if (!current || !tipsRef.current.some((candidate) => candidate.id === current.id)) showNext()
    scheduleRotation()
    return () => {
      if (rotateTimer.current) clearTimeout(rotateTimer.current)
      rotateTimer.current = null
    }
  }, [active, showNext, scheduleRotation])

  /**
   * React to the MOMENT, not only to the clock.
   *
   * A tool starts streaming, the context fills, a message queues — and the band goes on
   * showing whatever the last tick chose, for up to a full rotation. Since a gate's
   * specificity is what ranks tips, "something better now applies" is a comparison, not
   * a guess: swap only when the best eligible tip is MORE specific than the one up,
   * which is exactly when the moment has outrun it.
   *
   * The timer is re-armed rather than left alone, so the tip just shown gets its whole
   * turn instead of inheriting the remainder of the previous one.
   */
  const moment = `${ctx.activeToolName ?? ''}|${[...ctx.signals].sort().join(',')}`
  useEffect(() => {
    if (!active) return
    const best = topSpecificity(ctxRef.current, shownThisRun, tipsRef.current)
    if (!shouldSwapForMoment(band.tip, best, Date.now() - band.shownAt)) return
    showNext()
    scheduleRotation()
  }, [moment, active, showNext, scheduleRotation])

  const dismiss = useCallback(() => {
    band.tip?.onDismiss?.()
    setBand({ dismissed: true })
  }, [])

  // A local settings tip disappears immediately after its action or eligibility
  // changes, rather than leaving an obsolete invitation up until the next tick.
  const visible =
    active && tip && tips.some((candidate) => candidate.id === tip.id) && (tip.eligible?.() ?? true)
  return { tip: dismissed || !visible ? null : tip, dismiss }
}
