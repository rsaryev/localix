/**
 * Settle timing — wait for the page to actually COMMIT a change before we resample it.
 *
 * Why this is not just `await raf()`: a CSS `transition` on the restyled property means
 * getComputedStyle returns an INTERPOLATED value, so a signature sampled right after a
 * click still reads the OLD colour and the diff falsely reports "(no visible change)"
 * for a theme toggle that IS working. And rAF is PAUSED in a hidden tab,
 * so it is raced against a native timer captured at module load —
 * otherwise a backgrounded preview stalls the whole round-trip.
 */

/** performance.now() when available (monotonic), else Date.now(). */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

// Native timer captured at MODULE LOAD — before the page's own scripts can patch
// window.setTimeout — so the settle's fallback fires even in a backgrounded tab, where
// rAF is paused and never runs. This is what stops a paused rAF from stalling the whole
// `Browser` tool round-trip.
const nativeSetTimeout: (cb: () => void, ms: number) => unknown =
  typeof setTimeout === 'function' ? setTimeout.bind(globalThis) : () => undefined

/** How long one settle frame waits for rAF before the native fallback resolves it. */
const FRAME_FALLBACK_MS = 50

/**
 * One settle frame. rAF fires within ~16ms in a VISIBLE tab (and wins this race, so the
 * normal case is unchanged), but it is PAUSED in a hidden/backgrounded preview tab — so
 * we race it against a short NATIVE timer. Either winner resolves the frame; the loser's
 * later callback is a no-op.
 */
function settleFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => finish())
    nativeSetTimeout(finish, FRAME_FALLBACK_MS)
  })
}

/**
 * Settle after a state-changing action: yield two animation frames (framework commit
 * + first paint), then wait until html/body CSS transitions/animations FINISH, so a
 * post-action color resample reflects the settled value, not a mid-transition
 * interpolation. Bounded by `maxWaitMs` (a non-animated page exits after the two
 * frames; a persistent animation can't stall past the cap). `Element.getAnimations`
 * is scoped to html/body (not the whole document) so an unrelated spinner elsewhere
 * doesn't force every action to the cap. Every wait uses the rAF-with-native-fallback
 * frame (or a native timer), so a PAUSED (hidden tab) rAF can never stall the settle —
 * and thus the command awaiting it — past the cap.
 */
/** Two frames: long enough for a framework to commit what the last action changed, so the
 *  next step of a batch targets the updated DOM. No transition wait — nothing is sampled. */
export async function settleCommit(): Promise<void> {
  await settleFrame()
  await settleFrame()
}

export function settleTransitions(maxWaitMs = 400): Promise<void> {
  const hasPending = (): boolean => {
    try {
      const els = [document.documentElement, document.body].filter(Boolean) as Element[]
      const anims = els.flatMap((el) =>
        typeof el.getAnimations === 'function' ? el.getAnimations() : [],
      )
      return anims.some((a) => a.playState === 'running' || a.pending)
    } catch {
      return false
    }
  }
  return (async () => {
    const start = now()
    await settleFrame()
    await settleFrame()
    while (hasPending() && now() - start < maxWaitMs) {
      await new Promise<void>((resolve) => nativeSetTimeout(() => resolve(), 16))
    }
  })()
}
