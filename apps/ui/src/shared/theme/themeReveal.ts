/**
 * The visual delivery of a theme change: either an instant flip with transitions
 * suppressed, or a circular View-Transition reveal expanding from the pressed control.
 *
 * Split from `useTheme.ts` so the store stays about STATE (mode, resolution,
 * subscribers) while this file owns everything about how the flip is painted.
 * Neither function touches theme state — they take the commit as a callback.
 */

/** Pointer position (viewport px) used as the origin of the reveal animation. */
export interface ThemeChangeOrigin {
  x: number
  y: number
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

function supportsReveal(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (document as ViewTransitionDocument).startViewTransition === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * View Transitions rasterize the whole page twice (old + new snapshot). On a
 * heavy dialog — thousands of nodes, embedded plugin iframes — that snapshot is
 * what makes the toggle feel sluggish, while the home screen stays instant.
 * Above this budget we skip the reveal animation and switch instantly.
 */
const REVEAL_DOM_NODE_BUDGET = 6000

function isDomTooHeavyForReveal(): boolean {
  return (
    document.getElementsByTagName('iframe').length > 0 ||
    document.getElementsByTagName('*').length > REVEAL_DOM_NODE_BUDGET
  )
}

/** Whether this flip can afford the animated reveal at all. */
export function canRevealThemeChange(origin: ThemeChangeOrigin | undefined): boolean {
  return Boolean(origin) && supportsReveal() && !isDomTooHeavyForReveal()
}

/**
 * Instant switch. Without `.theme-switching` every element with a color
 * transition (buttons, links, inputs — see the base layer rule) animates
 * the flip simultaneously; on a heavy dialog that's thousands of
 * concurrent transitions and the real source of the toggle lag. Disable
 * transitions for the flip, re-enable after styles have applied.
 */
export function applyThemeChangeInstantly(commit: () => void): void {
  const root = document.documentElement
  root.classList.add('theme-switching')
  commit()
  // Double rAF: the first fires before paint, the second after the new
  // theme's recalc+paint — only then is it safe to re-enable transitions.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove('theme-switching'))
  })
}

/** Animated circular reveal from `origin`. Caller must have checked `canRevealThemeChange`. */
export function revealThemeChange(origin: ThemeChangeOrigin, commit: () => void): void {
  const root = document.documentElement
  // Radius needed to cover the whole viewport from the origin point.
  const radius = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y),
  )
  root.style.setProperty('--theme-reveal-x', `${origin.x}px`)
  root.style.setProperty('--theme-reveal-y', `${origin.y}px`)
  root.style.setProperty('--theme-reveal-r', `${radius}px`)

  // All theme changes happen INSIDE the transition callback so the View
  // Transition captures the new state and reveals it as one clean expanding
  // circle from the toggle. The `data-theme` flip (the visual change) is a
  // direct DOM write — captured synchronously. The store notify is NOT
  // flushSync'd, so the component re-render is deferred off the critical path:
  // no multi-second freeze, and — because data-theme is only ever written here,
  // never out-of-band before the snapshot overlay is up — no pre-flash of the
  // new theme. The reveal simply fills from the button outward.
  root.classList.add('theme-switching')
  const transition = (document as ViewTransitionDocument).startViewTransition!(commit)

  transition.finished.finally(() => root.classList.remove('theme-switching')).catch(() => {})

  transition.ready
    .then(() => {
      const { duration, easing } = revealMotion(root)
      root.animate(
        {
          clipPath: [
            `circle(0px at ${origin.x}px ${origin.y}px)`,
            `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
          ],
        },
        {
          duration,
          easing,
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {})
}

/**
 * The sweep's timing, read from the motion tokens rather than restated. It was `520` and the
 * `--ease-soft` curve copied as a string, so retuning the tokens retimed every CSS transition in
 * the app and left this one — the most visible motion there is — on the old values. The fallbacks
 * only apply before the stylesheet has loaded, when there is no theme to sweep to anyway.
 */
function revealMotion(root: HTMLElement): { duration: number; easing: string } {
  const tokens = getComputedStyle(root)
  const duration = Number.parseFloat(tokens.getPropertyValue('--dur-slow'))
  const easing = tokens.getPropertyValue('--ease-soft').trim()
  return {
    duration: Number.isFinite(duration) ? duration : 500,
    easing: easing || 'cubic-bezier(0.22, 1, 0.36, 1)',
  }
}
