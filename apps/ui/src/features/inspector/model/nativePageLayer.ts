/**
 * When the desktop browser page is live, and when a picture of it stands in its place.
 *
 * The page is a platform WebView that the desktop shell stacks ABOVE the app's own WebView. No
 * HTML can paint over it and no CSS can clip it, so an app overlay drawn across its rectangle — a
 * dialog, a menu, the address bar's history list — opens underneath the page. The page therefore
 * steps aside while any overlay is on screen: the native view is hidden, and a picture of its last
 * frame takes its place in the DOM, where the overlay stacks above it like any other element.
 *
 * The one ordering rule is picture first, hide second: the picture is taken while the page is
 * still live, and the page hides once the picture is painted — or when the capture budget runs
 * out, because an overlay the user opened must never wait on a slow capture. The overlay's own
 * entrance animation covers that window.
 */

export interface PageFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface PageBounds extends PageFrame {
  visible: boolean
}

export interface NativePageLayerPorts {
  /** Place or hide the native page. */
  apply: (bounds: PageBounds) => void
  /** A picture of the live page as an image URL; rejects where the host cannot capture. */
  capture: () => Promise<string>
  /** Paint a picture in the page's place; resolves once it is on screen. */
  showPicture: (url: string) => Promise<void>
  /**
   * Whether the page is stepped aside for an overlay. The box tones its picture with the app's
   * ground while it is: the app's glass is tuned to frost over that ground, and over a bright
   * page it washes out instead.
   */
  setPaused: (paused: boolean) => void
  /** Run `task` after `ms` and return its cancel. Injected so tests own the clock. */
  schedule: (task: () => void, ms: number) => () => void
}

/** How long an overlay's entrance may wait for the picture before the page hides without one. */
export const CAPTURE_BUDGET_MS = 150

const NO_FRAME: PageFrame = { x: 0, y: 0, width: 0, height: 0 }

export interface NativePageLayer {
  /** The native page exists and can be shown. */
  opened(): void
  /** The browser tab is the one on screen in its pane. */
  setActive(active: boolean): void
  /** The page's rectangle in window coordinates, or `null` while its box is not displayed. */
  setFrame(frame: PageFrame | null): void
  /** Whether any app overlay is on screen (the focus stack's `overlayOnScreen`). */
  setOverlay(onScreen: boolean): void
  /** Hide the page for good and ignore everything still in flight. */
  dispose(): void
}

export function createNativePageLayer(ports: NativePageLayerPorts): NativePageLayer {
  let isOpened = false
  let active = false
  let frame: PageFrame | null = null
  let overlay = false
  /** Hidden for the overlay currently on screen. */
  let yielded = false
  /** What the native side was last told, so a capture is only attempted of a live page. */
  let shown = false
  /** One per overlay appearance; a capture from an earlier one must not act on this one. */
  let episode = 0
  let cancelBudget: (() => void) | null = null
  let cancelRelease: (() => void) | null = null
  let disposed = false

  function render(): void {
    // Until the native page exists there is nothing to place: a bounds call for it would only
    // come back as "Browser tab is not open".
    if (disposed || !isOpened) return
    const wanted = active && frame !== null && frame.width > 0 && frame.height > 0 && !yielded
    ports.apply({ ...(frame ?? NO_FRAME), visible: wanted })
    shown = wanted
  }

  function yieldTo(next: boolean): void {
    if (yielded === next) return
    yielded = next
    ports.setPaused(next)
  }

  function stepAside(forEpisode: number): void {
    if (disposed || forEpisode !== episode || yielded) return
    cancelBudget?.()
    cancelBudget = null
    yieldTo(true)
    render()
  }

  function beginOverlay(): void {
    episode += 1
    // Nothing live to picture: the page is already hidden, so it simply stays that way.
    if (!shown) {
      yieldTo(true)
      return
    }
    const current = episode
    cancelBudget = ports.schedule(() => stepAside(current), CAPTURE_BUDGET_MS)
    void ports
      .capture()
      .then((url) => (current === episode && !disposed ? ports.showPicture(url) : undefined))
      .catch(() => {
        // A host that cannot capture still hides the page; the box shows its plain ground.
      })
      .finally(() => stepAside(current))
  }

  function endOverlay(): void {
    overlay = false
    episode += 1
    cancelBudget?.()
    cancelBudget = null
    yieldTo(false)
    render()
  }

  return {
    opened() {
      isOpened = true
      render()
    },
    setActive(next) {
      active = next
      render()
    },
    setFrame(next) {
      frame = next
      render()
    },
    setOverlay(onScreen) {
      if (disposed) return
      if (onScreen) {
        // A menu that closes as the next one opens releases and claims in the same task; showing
        // the live page between the two would flash it for one capture's length.
        cancelRelease?.()
        cancelRelease = null
        if (overlay) return
        overlay = true
        beginOverlay()
        render()
        return
      }
      if (!overlay || cancelRelease) return
      cancelRelease = ports.schedule(() => {
        cancelRelease = null
        endOverlay()
      }, 0)
    },
    dispose() {
      cancelBudget?.()
      cancelRelease?.()
      // A page still being created is born hidden, so only an opened one needs hiding.
      if (isOpened) ports.apply({ ...NO_FRAME, visible: false })
      disposed = true
    },
  }
}
