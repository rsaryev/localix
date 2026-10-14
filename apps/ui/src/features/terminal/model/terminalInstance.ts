import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { readTheme } from './terminalTheme'
import { codeFontSize } from '@localixai/kit/lib'

/** Used only until the real code font resolves — see below. */
const FALLBACK_MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace'

export interface TerminalInstance {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  /** Stop the font/theme watchers. The caller still disposes `term` itself. */
  dispose: () => void
}

/**
 * Build the xterm instance for a pane, with the two bits of app integration that xterm
 * cannot express itself.
 *
 * xterm needs CONCRETE values — it measures a real cell box at open time — so neither the
 * `--font-mono` var nor a rem font size can be handed to it. Both are therefore READ from
 * the live computed style at creation:
 *
 *  - The FONT is read once, but a web font that finishes loading AFTER open would leave
 *    the terminal measured against the fallback's metrics forever, so `fonts.ready`
 *    re-applies it and re-fits.
 *  - The DENSITY ratio scales the shared code measure. Read at creation only: changing density
 *    while a pane is open applies to the next terminal opened, not this one.
 *  - The THEME is captured as concrete rgb values at open, so a light/dark toggle would
 *    otherwise leave the terminal on the old palette. A MutationObserver on the root's
 *    `data-theme`/`class` re-applies it.
 *
 * `isDisposed` is threaded in rather than checked by the caller because both watchers fire
 * ASYNCHRONOUSLY and can outlive the pane.
 */
export function createTerminalInstance(
  host: HTMLElement,
  isDisposed: () => boolean,
  /**
   * Re-fit through the PANE's sizer, returning false if it is not wired yet.
   *
   * A bare `fit.fit()` here resized xterm's grid but told the PTY NOTHING: the fit
   * changes the `.xterm` element, not the observed host, so the pane's
   * ResizeObserver never fires and no SIGWINCH is sent. The shell kept drawing to
   * the row count it was last given while xterm had a different one, which is how
   * a full-screen app's bottom status line ended up rendered outside the visible
   * grid. The sizer is what couples a re-fit to the PTY, so the remeasure has to
   * go through it.
   */
  remeasure?: () => boolean,
): TerminalInstance {
  const resolveMono = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
    FALLBACK_MONO

  const term = new Terminal({
    // Without this xterm composites every theme color onto an opaque layer, which turns the
    // transparent background from terminalTheme.ts back into a black slab over the glass ground.
    allowTransparency: true,
    // `registerDecoration` is marked EXPERIMENTAL in the xterm typings, and xterm THROWS on a
    // proposed API unless this is set. Shell integration draws the per-command exit-code dot
    // with it (terminalShellIntegration.ts), and its parse-loop guard turned that throw into a
    // single warning — so the affordance was dead in every pane while the terminal looked fine.
    // The guard stays: it is what keeps a future proposed-API change from freezing the pane.
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily: resolveMono(),
    fontSize: codeFontSize(),
    lineHeight: 1.2,
    theme: readTheme(),
    scrollback: 5000,
  })

  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  term.open(host)

  // Re-measure against the real face once the web font lands. The new metrics
  // usually change the row count, so this must reach the PTY too — see `remeasure`.
  void document.fonts?.ready.then(() => {
    if (isDisposed()) return
    term.options.fontFamily = resolveMono()
    if (remeasure?.()) return
    try {
      fit.fit()
    } catch {
      /* not laid out yet */
    }
  })

  const themeObserver = new MutationObserver(() => {
    requestAnimationFrame(() => {
      if (!isDisposed()) term.options.theme = readTheme()
    })
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  })

  return { term, fit, search, dispose: () => themeObserver.disconnect() }
}
