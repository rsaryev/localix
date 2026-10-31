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
export function now(): number {
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

/** Sleep on the native timer: unlike rAF it keeps firing in a hidden tab. */
export function nativeSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => nativeSetTimeout(resolve, ms))
}

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

/** What the settle needs from the page; injected by tests so no test sleeps. */
export interface SettleEnv {
  now: () => number
  sleep: (ms: number) => Promise<void>
  frame: () => Promise<void>
  /** Calls `onMutation` on every DOM change until the returned function is called. */
  watch: (onMutation: () => void) => () => void
  /** An html/body animation or transition is still running. */
  animating: () => boolean
}

/** Shortest settle, the quiet the DOM must keep, the poll step, and the default cap. */
const MIN_SETTLE_MS = 30
const QUIET_MS = 100
const POLL_MS = 16
const SETTLE_CAP_MS = 700

function animating(): boolean {
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

function watchDom(onMutation: () => void): () => void {
  if (typeof MutationObserver !== 'function' || !document.documentElement) return () => {}
  const observer = new MutationObserver(onMutation)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  return () => observer.disconnect()
}

const pageEnv: SettleEnv = {
  now,
  sleep: nativeSleep,
  frame: settleFrame,
  watch: watchDom,
  animating,
}

/**
 * Settle after a state-changing action: wait until the DOM has been quiet for 100 ms (and the
 * settle ran at least 30 ms) with no html/body animation running, so a result that arrives from
 * the network, or a transition's final colour, is in the resample. Bounded by `maxWaitMs`
 * (default 700): a page that never stops changing cannot stall the command. Every wait is
 * a native timer or the rAF-with-native-fallback frame, so a hidden tab (paused rAF) or a
 * page that patched setTimeout cannot stall it. `Element.getAnimations` is scoped to html/body
 * so an unrelated spinner elsewhere does not force every action to the cap.
 */
export async function settleTransitions(
  maxWaitMs = SETTLE_CAP_MS,
  env: SettleEnv = pageEnv,
): Promise<void> {
  const start = env.now()
  let last = start
  const stop = env.watch(() => {
    last = env.now()
  })
  try {
    await env.frame()
    await env.frame()
    for (;;) {
      const t = env.now()
      if (t - start >= maxWaitMs) return
      if (t - start >= MIN_SETTLE_MS && t - last >= QUIET_MS && !env.animating()) return
      await env.sleep(POLL_MS)
    }
  } finally {
    stop()
  }
}
