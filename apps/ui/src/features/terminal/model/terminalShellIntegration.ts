import type { Terminal } from '@xterm/xterm'
import type { IMarker } from '@xterm/xterm'
import { parseOsc133, exitDotColor } from './shellIntegration'
import { extractCommandText, extractOutputText, type RowAt } from './terminalCommands'
import { computeQuickFixes } from './terminalQuickFixes'
import { computeStickyCommand } from './terminalStickyScroll'
import { createGuard } from './terminalGuard'
import type { CommandMenuState } from '../ui/TerminalCommandMenu'

/** Sticky-scroll header: the running/scrolled command whose prompt is off the top
 *  of the viewport (null = nothing to pin). `line` is its prompt row. */
export type StickyState = { text: string; line: number } | null

export interface ShellIntegration {
  /** ⌘↑ / ⌘↓ — jump the viewport to the previous / next command prompt. */
  jumpCommand: (dir: -1 | 1) => void
  /** Call from the pane's `term.onData` handler BEFORE forwarding the keystroke:
   *  captures the real input column on the first keystroke at an old-rc prompt. */
  noteKeystroke: () => void
  /** Recompute the pinned sticky command (call on scroll — internal — and resize). */
  refresh: () => void
  /** Tear down the OSC handler + scroll subscription (markers are freed by xterm on
   *  `term.dispose()`). Disposes in the same order the pane's cleanup used. */
  dispose: () => void
}

/**
 * Shell integration (OSC 133) + sticky-scroll for one terminal pane, extracted from
 * TerminalPane verbatim so the byte-critical marker/decoration timing is preserved.
 * The injected shell rc emits semantic-prompt marks (A→B→C→D) so we can draw a
 * per-command exit-code dot in the gutter, jump between prompts, and pin the running
 * command's prompt when it scrolls off the top. All marks are silently swallowed by
 * xterm when this handler isn't present, so old output is safe.
 *
 * `onSticky` / `onCommandMenu` are the pane's React state setters (sticky header /
 * exit-dot action menu); `isDisposed` mirrors the effect's disposed flag so the
 * per-scroll-frame recompute short-circuits during teardown.
 */
export function createShellIntegration(opts: {
  term: Terminal
  isDisposed: () => boolean
  onSticky: (update: StickyState | ((prev: StickyState) => StickyState)) => void
  onCommandMenu: (menu: CommandMenuState) => void
}): ShellIntegration {
  const { term, isDisposed, onSticky, onCommandMenu } = opts

  // Read a physical buffer row (untrimmed, with its soft-wrap flag) for command/
  // output extraction — translateToString(false) keeps columns intact so the
  // prompt can be sliced off by the `B` input-start column.
  const rowAt: RowAt = (line) => {
    const row = term.buffer.active.getLine(line)
    return { text: row ? row.translateToString(false) : '', wrapped: row?.isWrapped ?? false }
  }

  // Crash-proofing for everything that runs inside xterm's parse/write loop. A
  // throw escaping an OSC handler or a decoration render callback aborts the
  // write loop and freezes the pane mid-stream, so every such callback is wrapped
  // (see terminalGuard.ts). One guard instance per pane → warn-once is per-pane.
  const guard = createGuard()
  // `registerMarker` is documented to return `IMarker`, but treat it as fallible:
  // it can hand back undefined (disposed terminal) or throw (proposed-API gating
  // after a version bump). Never let that reach the parser.
  const safeMarker = (): IMarker | null =>
    guard('registerMarker', () => term.registerMarker(0) ?? null, null)

  const commandMarkers: IMarker[] = []
  // Live command regions for sticky-scroll: prompt marker + end marker (null
  // while running) + the typed text. Pruned lazily when markers dispose.
  const stickyEntries: { prompt: IMarker; end: IMarker | null; text: string }[] = []
  let currentEntry: { prompt: IMarker; end: IMarker | null; text: string } | null = null

  // Recompute the pinned command from the current viewport top. Cheap: only
  // flips React state when the pinned command actually changes.
  const updateSticky = () =>
    guard(
      'updateSticky',
      () => {
        if (isDisposed()) return
        // Compact first: a disposed prompt marker (line trimmed past the scrollback
        // cap, or ⌘K clear) never revives, so its entry can never pin again. Without
        // this the array grows for the pane's whole lifetime (panes stay mounted
        // across session switches) while this handler runs on every scroll frame.
        for (let i = stickyEntries.length - 1; i >= 0; i--) {
          if (stickyEntries[i].prompt.isDisposed) stickyEntries.splice(i, 1)
        }
        const buf = term.buffer.active
        if (buf.type === 'alternate') {
          onSticky(null)
          return
        } // full-screen TUIs: no prompts to pin
        const topLine = buf.viewportY
        const commands = stickyEntries.flatMap((e) =>
          e.prompt.isDisposed
            ? []
            : [
                {
                  promptLine: e.prompt.line,
                  endLine: e.end && !e.end.isDisposed ? e.end.line : null,
                  text: e.text,
                },
              ],
        )
        const pick = computeStickyCommand(topLine, commands)
        onSticky((prev) => {
          if (!pick) return prev === null ? prev : null
          if (prev && prev.line === pick.promptLine && prev.text === pick.text) return prev
          return { text: pick.text, line: pick.promptLine }
        })
      },
      undefined,
    )

  // The command currently being assembled from its A→B→C→D marks.
  let inputMarker: IMarker | null = null // prompt/input row (re-anchored at B), gutter-decorated
  let inputStartX = 0 // column just past the prompt (captured at B)
  // B arrived at column 0 (an old pre-fix rc still running in this PTY emitted
  // it from precmd, BEFORE the prompt painted) → the real input column is
  // unknown; it's lazily captured on the first keystroke (cursor sits at the
  // prompt's end just before the echo). While pending, the typed input reads
  // as '' — correct for an untouched prompt.
  let inputStartPending = false
  let outputMarker: IMarker | null = null // output-start row (C)

  // The whole body runs inside xterm's parse loop → wrap it so no exception can
  // ever escape and abort the write loop (which would freeze the pane mid-stream).
  // On a throw we claim the OSC as handled (return true) and drop the affordance.
  const osc133 = term.parser.registerOscHandler(133, (payload) =>
    guard(
      'osc133',
      () => {
        const ev = parseOsc133(payload)
        if (!ev) return false
        if (ev.type === 'A') {
          // New prompt: anchor its line (drop any prior unused/empty-prompt anchor).
          if (inputMarker && !outputMarker) inputMarker.dispose()
          inputMarker = safeMarker()
          inputStartX = 0
          inputStartPending = false
          outputMarker = null
        } else if (ev.type === 'B') {
          // Input starts HERE (the prompt has painted) → re-anchor the marker to
          // the B row (a multi-line prompt paints A on an earlier row) and remember
          // the column so the prompt can be stripped from the typed input.
          if (inputMarker && !outputMarker) {
            inputMarker.dispose()
            inputMarker = safeMarker()
            inputStartX = term.buffer.active.cursorX
            // Column 0 = an old pre-fix rc emitted B from precmd before the prompt
            // painted → capture the real input column on the first keystroke.
            inputStartPending = inputStartX === 0
          }
        } else if (ev.type === 'C') {
          // A command actually started → anchor its output and earn a decoration on `D`.
          if (inputMarker) {
            outputMarker = safeMarker()
            // Record the running region for sticky-scroll (end filled in at `D`).
            const text = extractCommandText(
              rowAt,
              inputMarker.line,
              inputStartX,
              outputMarker?.line ?? inputMarker.line,
            )
            if (text) {
              currentEntry = { prompt: inputMarker, end: null, text }
              stickyEntries.push(currentEntry)
              updateSticky()
            } else {
              currentEntry = null
            }
          }
        } else if (ev.type === 'D') {
          const inMarker = inputMarker
          const outMarker = outputMarker
          const startX = inputStartX
          const exitCode = ev.exitCode
          inputMarker = null
          outputMarker = null
          const entry = currentEntry
          currentEntry = null
          if (inMarker && !inMarker.isDisposed && outMarker) {
            // Compact disposed markers in place (scrollback trim / ⌘K clear) — they
            // never revive, and the array otherwise grows unboundedly over a
            // long-lived pane (panes stay mounted across session switches).
            for (let i = commandMarkers.length - 1; i >= 0; i--) {
              if (commandMarkers[i].isDisposed) commandMarkers.splice(i, 1)
            }
            commandMarkers.push(inMarker)
            const endMarker = safeMarker()
            // Close the sticky region: the command is no longer running, so its
            // pin only shows while scrolled inside its (now-bounded) output.
            if (entry?.prompt === inMarker) {
              entry.end = endMarker
              updateSticky()
            }
            const title =
              ev.exitCode === null
                ? 'Command finished — click for actions'
                : `Exit code ${ev.exitCode} — click for actions`
            const deco = term.registerDecoration({ marker: inMarker, x: 0, width: 1 })
            if (deco) {
              // onRender runs inside xterm's render loop; guard it too so a styling
              // throw can't brick the terminal (fires again on scroll/resize).
              deco.onRender((el) =>
                guard(
                  'exitDot.render',
                  () => {
                    el.style.width = '5px'
                    el.style.height = '5px'
                    el.style.borderRadius = '9999px'
                    el.style.marginTop = '5px'
                    // Recomputed per render so dots recolor when the themeObserver
                    // forces a re-render on a data-theme flip.
                    el.style.backgroundColor = exitDotColor(
                      ev.exitCode,
                      document.documentElement.dataset.theme === 'light',
                    )
                    el.style.cursor = 'pointer'
                    el.title = title
                    // Idempotent: onRender fires again on scroll/resize.
                    el.onclick = (e) =>
                      guard(
                        'exitDot.click',
                        () => {
                          e.stopPropagation()
                          const command = inMarker.isDisposed
                            ? ''
                            : extractCommandText(
                                rowAt,
                                inMarker.line,
                                startX,
                                outMarker.isDisposed ? inMarker.line : outMarker.line,
                              )
                          const output =
                            outMarker.isDisposed || !endMarker || endMarker.isDisposed
                              ? ''
                              : extractOutputText(rowAt, outMarker.line, endMarker.line)
                          const fixes = computeQuickFixes({ command, output, exitCode })
                          onCommandMenu({ x: e.clientX, y: e.clientY, command, output, fixes })
                        },
                        undefined,
                      )
                  },
                  undefined,
                ),
              )
              inMarker.onDispose(() => {
                deco.dispose()
                endMarker?.dispose()
              })
            }
          }
        }
        return true
      },
      true,
    ),
  )

  // ⌘↑ / ⌘↓ — jump the viewport to the previous / next command prompt.
  const jumpCommand = (dir: -1 | 1) => {
    const markers = commandMarkers.filter((m) => !m.isDisposed).sort((a, b) => a.line - b.line)
    if (markers.length === 0) return
    const top = term.buffer.active.viewportY
    const target =
      dir < 0 ? [...markers].reverse().find((m) => m.line < top) : markers.find((m) => m.line > top)
    if (target) term.scrollToLine(target.line)
  }

  // Sticky-scroll: re-evaluate the pinned command as the viewport scrolls.
  const scrollSub = term.onScroll(() => updateSticky())

  // First keystroke at a prompt whose input column is still pending (old-rc
  // B at column 0): the cursor sits at the prompt's end BEFORE this key
  // echoes — capture the real input start now.
  const noteKeystroke = () => {
    if (inputStartPending && inputMarker && !outputMarker) {
      inputStartX = term.buffer.active.cursorX
      inputStartPending = false
    }
  }

  return {
    jumpCommand,
    noteKeystroke,
    refresh: updateSticky,
    dispose: () => {
      scrollSub.dispose()
      osc133.dispose()
    },
  }
}
