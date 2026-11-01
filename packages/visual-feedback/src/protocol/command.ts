/**
 * Visual-feedback bridge protocol — the agent `VfCommand` (and its `VfStep`s). PURE types, zero
 * DOM/runtime. Split out of protocol/index.ts, which re-exports it, so importers keep one path.
 */

/* ------------------------------------------------------------------ *
 * Agent-driven control (the `Browser` tool drives these).
 *
 * The agent never talks to the page directly: a server→host→probe relay
 * delivers a `command`; the probe executes it (read the page as a snapshot,
 * synthesize a click/type/scroll, or read console) and replies with a
 * `command-result`. Targeting is by `@eN` ref (from the latest snapshot) OR a
 * CSS selector. Kept FLAT (per-action params as optional siblings, no nested
 * unions) so a Zod mirror of this on the tool side stays provider-compatible.
 * ------------------------------------------------------------------ */

export type VfCommandAction =
  | 'snapshot'
  | 'screenshot'
  | 'click'
  | 'type'
  | 'select'
  | 'press'
  | 'scroll'
  | 'hover'
  | 'console'
  | 'steps'
  | 'evaluate'
  | 'wait'
  | 'read'
  | 'back'
  | 'forward'
  | 'reload'

/** One step inside a `steps` batch: the page-mutating interactions PLUS the read
 *  actions `snapshot`/`evaluate`/`console`, so a batch can act THEN observe in one call
 *  (e.g. `[{click…},{snapshot}]` or `[{click…},{evaluate 'data-theme'}]`). The
 *  dispatcher runs each step generically; a trailing `snapshot` returns the fresh tree. */
export interface VfStep {
  action:
    | 'click'
    | 'type'
    | 'select'
    | 'press'
    | 'scroll'
    | 'hover'
    | 'snapshot'
    | 'evaluate'
    | 'console'
    | 'wait'
  ref?: string
  selector?: string
  text?: string
  key?: string
  keys?: string[]
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  /** `evaluate` step: the JS expression to run in the page (its value is surfaced). */
  expression?: string
  /** `wait` step: hold until this is GONE instead of present. */
  gone?: boolean
  /** `wait` step: the longest wait in ms (default 10 s, capped at 15 s). */
  timeoutMs?: number
}

/** A single agent command. Only the fields relevant to `action` are read. */
export interface VfCommand {
  action: VfCommandAction
  /** Target by ref (`e3` / `@e3`, from the latest snapshot) — preferred. */
  ref?: string
  /** Target by CSS selector (fallback / first interaction before a snapshot). */
  selector?: string
  /** `type`: literal text to insert into the focused/targeted field. `select`: the option's value or label. */
  text?: string
  /** `press`: a key name or chord, e.g. `Enter`, `Tab`, `Ctrl+a`, `Escape`. */
  key?: string
  /** `press`: a SEQUENCE of keys to send in one call (fewer round-trips), e.g.
   *  `["ArrowUp","ArrowRight","ArrowUp"]`. Combine with `snapshotAfter` to read once. */
  keys?: string[]
  /** `scroll`: direction when not scrolling an element into view. */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** `scroll`: pixels (default a viewport-ish step). */
  amount?: number
  /** `snapshot`: only interactive nodes (buttons/links/inputs/…). */
  interactiveOnly?: boolean
  /**
   * `screenshot`: bring the target into view and answer with its `rect` and the `viewport`,
   * without rendering a picture. A host that can capture the real pixels (the native WebView)
   * crops its own capture to that rect instead of the slow in-page rasterizer.
   */
  locateOnly?: boolean
  /** `snapshot`: max tree depth. */
  maxDepth?: number
  /** For a state-changing action (click/type/press/scroll/hover): also return a
   *  FRESH snapshot of the resulting page, so the agent reads the new state without
   *  a separate `snapshot` round-trip. Refs are reassigned (the page changed). */
  snapshotAfter?: boolean
  /** `steps`: an ordered batch of interactions to run in ONE call (e.g. type a
   *  field then click submit). Combine with `snapshotAfter` to read the result once. */
  steps?: VfStep[]
  /** `evaluate`: a JS expression evaluated in the PAGE realm; its value (awaited if a
   *  Promise) is serialized back. Reads exact runtime state the a11y snapshot can't
   *  expose — e.g. `window.board`, `document.querySelector('#score').textContent`. */
  expression?: string
  /** `wait` (a step): hold until `text` or `selector` is gone instead of present. */
  gone?: boolean
  /** `wait` (a step): the longest wait in ms. */
  timeoutMs?: number
  /** `read`: the character to start the window at (default 0). */
  offset?: number
}
