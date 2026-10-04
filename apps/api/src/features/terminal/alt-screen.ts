/**
 * Streaming alternate-screen detector for raw PTY output. A full-screen TUI app
 * (claude, vim, htop, a REPL menu) announces itself by switching the terminal to
 * the ALTERNATE screen buffer — DECSET 1049 (modern), 1047, or 47 — and leaves it
 * with the matching DECRST. Tracking that switch on the SERVER side tells us a
 * PTY is currently running a full-screen app even when no client is attached,
 * which is what lets the UI auto-reveal a tab-less terminal the moment something
 * interactive takes it over (an unseen full-screen app is unusable).
 *
 * Chunk-safety: escape sequences can split across PTY data chunks, so the
 * tracker carries a small tail of the previous chunk into the next scan. The
 * overlap may re-match an already-applied sequence — harmless, because state is
 * simply "the LAST enter/leave wins", which re-applying reproduces.
 */

/** DECSET/DECRST for the alternate screen: CSI ? (1049|1047|47) h|l. */
// oxlint-disable-next-line no-control-regex -- matches the ESC-introduced DECSET/DECRST alt-screen sequence
const ALT_SCREEN_RE = /\x1b\[\?(?:1049|1047|47)([hl])/g

/** Longest prefix of an alt-screen sequence that can dangle at a chunk edge
 *  (`ESC [ ? 1 0 4 9` = 8 chars; keep a little slack). */
const CARRY_LENGTH = 10

export interface AltScreenTracker {
  /** Scan a raw output chunk; returns the tracker's state after the chunk. */
  push(chunk: string): boolean
  /** True while the terminal sits on the alternate screen buffer. */
  readonly altScreen: boolean
}

export function createAltScreenTracker(): AltScreenTracker {
  let altScreen = false
  let carry = ''
  return {
    push(chunk: string): boolean {
      const haystack = carry + chunk
      ALT_SCREEN_RE.lastIndex = 0
      for (let m = ALT_SCREEN_RE.exec(haystack); m; m = ALT_SCREEN_RE.exec(haystack)) {
        altScreen = m[1] === 'h'
      }
      carry = haystack.slice(-CARRY_LENGTH)
      return altScreen
    },
    get altScreen() {
      return altScreen
    },
  }
}
