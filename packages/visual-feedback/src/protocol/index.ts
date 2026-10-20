/**
 * Visual-feedback bridge protocol — PURE types + constants, zero DOM/runtime.
 *
 * Imported by BOTH the host UI (`@localixai/visual-feedback/protocol`, type-only,
 * so it never drags probe runtime into the browser bundle) and the in-page probe.
 * Keep this file side-effect free and free of any `document`/`window` access at
 * module scope.
 */

/** postMessage discriminator: every bridge message carries `__vf` = this channel id. */
export const VF_BRIDGE_KEY = '__vf' as const

/** Protocol version — bumped if the message shape changes incompatibly. */
export const VF_PROTOCOL_VERSION = 2

/** Attribute the probe stamps on its own overlay nodes so hit-testing skips them. */
export const VF_IGNORE_ATTR = 'data-vf-ignore'

/** Probe selection mode, toggled by the host. `off` = inert (no outline/capture). */
export type VfMode = 'off' | 'comment'

/** A rect in the previewed page's viewport coordinates (CSS px, relative to the iframe). */
export interface VfRect {
  x: number
  y: number
  width: number
  height: number
}

/** Resolved source location for a picked element (best-effort, layered resolver). */
export interface VfSource {
  /** File path — for our static case this is the served file we know we're serving. */
  file?: string
  line?: number
  column?: number
  /** Framework component name, when a resolver can recover it. */
  component?: string
  /** Which resolver produced this — drives the confidence shown to the agent. */
  method: 'data-attr' | 'react-fiber' | 'served-file' | 'unknown'
  confidence: 'high' | 'medium' | 'low'
}

/** Everything the probe captures about one picked element. */
export interface VfCapture {
  /** Robust CSS selector (id > unique class > nth-of-type chain). */
  selector: string
  /** Human label, e.g. `button "Sign up"` or `section.hero`. */
  summary: string
  /** Readable DOM path, e.g. `header.nav > a`. */
  domPath: string
  /** Cleaned class list (CSS-module hashes stripped). */
  classes: string
  /** Semantic/aria role when present. */
  role?: string
  /** Trimmed own/nearby text for grep disambiguation. */
  text?: string
  /** React (or other framework) component ancestry, outer→inner, e.g. "Sidebar › Button".
   *  Recovered from the fiber even when source line info is stripped — a strong grep anchor. */
  componentPath?: string
  /** The element's opening tag with identifying attributes (aria-label, name, specific classes). */
  html?: string
  /** Compact computed-style snapshot relevant to the element kind. */
  computedStyle?: string
  /** Element rect in the iframe viewport (for host-side composer anchoring). */
  rect: VfRect
  /** Best-effort source mapping. */
  source?: VfSource
  /** Kind of pick. `area` carries only a rect (empty-space annotation). */
  kind: 'element' | 'text' | 'area' | 'multi'
  /** For `multi`, the extra members' selectors. */
  members?: string[]
}

/* ------------------------------------------------------------------ *
 * Agent-driven control (the `browser` tool drives these).
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
  | 'press'
  | 'scroll'
  | 'hover'
  | 'console'
  | 'steps'
  | 'evaluate'

/** One step inside a `steps` batch: the page-mutating interactions PLUS the read
 *  actions `snapshot`/`evaluate`/`console`, so a batch can act THEN observe in one call
 *  (e.g. `[{click…},{snapshot}]` or `[{click…},{evaluate 'data-theme'}]`). The
 *  dispatcher runs each step generically; a trailing `snapshot` returns the fresh tree. */
export interface VfStep {
  action: 'click' | 'type' | 'press' | 'scroll' | 'hover' | 'snapshot' | 'evaluate' | 'console'
  ref?: string
  selector?: string
  text?: string
  key?: string
  keys?: string[]
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  /** `evaluate` step: the JS expression to run in the page (its value is surfaced). */
  expression?: string
}

/** A single agent command. Only the fields relevant to `action` are read. */
export interface VfCommand {
  action: VfCommandAction
  /** Target by ref (`e3` / `@e3`, from the latest snapshot) — preferred. */
  ref?: string
  /** Target by CSS selector (fallback / first interaction before a snapshot). */
  selector?: string
  /** `type`: literal text to insert into the focused/targeted field. */
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
}

/** Size/shape stats for a snapshot — lets the agent reason about payload cost. */
export interface VfSnapshotStats {
  nodes: number
  interactive: number
  chars: number
}

/**
 * One INTERACTIVE node of a snapshot, structured: what a caller choosing among the page's
 * controls (a decision model, a test) reads instead of parsing the tree's lines.
 */
export interface VfElement {
  /** The node's `eN` ref, as in the tree. */
  ref: string
  role: string
  /** Accessible name; for a form field its label, never its value. */
  name: string
  /** A form field's current value (never a password's); absent when empty. */
  value?: string
  /** `disabled`, `checked`/`unchecked`, `expanded`/`collapsed`, `selected`, `required`, `readonly`. */
  states?: string[]
  /** Inside an open dialog (role dialog/alertdialog, or an open `<dialog>`): it holds the page. */
  dialog?: boolean
  /** Takes typed text: what a `type` step can fill. */
  editable?: boolean
}

/** A structured, accessibility-flavored read of the page (the primary channel). */
export interface VfSnapshot {
  /** Indented text tree, e.g. `- button "Submit" [ref=e3]`. */
  tree: string
  stats: VfSnapshotStats
  url: string
  title: string
  /** Page subresources that FAILED to load (stylesheet/script/image 404s etc.),
   *  deduped + capped. Present only when non-empty — a clean page carries nothing.
   *  Surfaces silent page-side breakage (e.g. a 404'd theme stylesheet) so the agent
   *  stops blaming a control that actually works. */
  failedResources?: string[]
  /** The interactive nodes in tree order, structured (at most 250); absent when there are none. */
  elements?: VfElement[]
}

export interface VfConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
}

/** A JPEG the probe rendered in-page (no screen-share permission needed). */
export interface VfImage {
  /** base64 (no `data:` prefix). */
  data: string
  mediaType: string
  width: number
  height: number
}

/** Result payload of one command (the success branch of `command-result`). */
export interface VfCommandResult {
  action: VfCommandAction
  /** `snapshot`. */
  snapshot?: VfSnapshot
  /** Acted/targeted element rect in iframe viewport px — the host uses it to grab a
   *  screenshot (`action:'screenshot'`) and the agent uses it as a position reference. */
  rect?: VfRect | null
  /** Short AX-tree text-diff after a state-changing action (vs the prior snapshot). */
  diff?: string
  /** `console`. */
  console?: VfConsoleEntry[]
  /** Short label of the acted element, e.g. `button "Submit"`. */
  target?: string
  /** Human/agent-readable note, e.g. `clicked button "Submit"`. */
  note?: string
  /** `screenshot`: the JPEG the probe rendered in-page (no permission needed). */
  image?: VfImage
  /** `screenshot` with `locateOnly`: the viewport, in the CSS px `rect` is measured in. */
  viewport?: { width: number; height: number }
  /** `evaluate`: the serialized result of the page-realm expression (string/JSON, capped). */
  value?: string
  /**
   * The page navigated/reloaded between the agent's PREVIOUS command and this one
   * (e.g. a dev-server file-watch auto-reload, or a `location.reload()`), so the DOM
   * state was reset and every ref handed out before is invalid. The probe detects
   * this across the reload via same-origin `sessionStorage` and flags the FIRST
   * command of the fresh page load. The tool prepends an explicit notice so the model
   * doesn't misread a reset (e.g. a theme attribute reverting) as a broken control.
   */
  reloaded?: boolean
  /**
   * Console errors/warnings — including uncaught exceptions, unhandled promise
   * rejections, and auto-dismissed native dialogs (`alert`/`confirm`/`prompt`) — that
   * fired DURING a drive action (click/type/press/scroll/hover/steps). Bounded (a few
   * entries, each truncated). Lets the agent see that a click's handler threw, or popped
   * an alert, on the SAME result instead of reading a silent "(no visible change)" diff.
   */
  recentErrors?: string[]
  /**
   * Page subresources that FAILED to load since the agent's PREVIOUS command, attached
   * to a diff-only DRIVE result (the snapshot path carries the FULL set on
   * `snapshot.failedResources` instead). Bounded; present only when non-empty. Surfaces
   * a mid-session 404 (e.g. a stylesheet gone after a file move) on the action that hit it.
   */
  failedResources?: string[]
}

/** Why a command failed — drives the agent's recovery (re-snapshot, dismiss overlay…). */
export type VfCommandErrorCode = 'not_found' | 'intercepted' | 'bad_request' | 'failed'

/** A comment's mark on the page: the element, and what pointing at it shows. */
export interface VfMark {
  id: string
  selector: string
  /** Its number in the comment list. */
  index: number
  note: string
}

/** Host → probe commands. */
export type VfHostMessage =
  | { type: 'set-mode'; mode: VfMode }
  | { type: 'theme'; vars: Record<string, string> }
  /** Tint every element that already carries a comment (re-sent after a reload). */
  | { type: 'set-marks'; marks: VfMark[] }
  /** Scroll a saved comment's element into view + highlight it (clicked in the list). */
  | { type: 'reveal'; selector: string }
  /** Agent-driven control: execute one command and reply with `command-result`. */
  | { type: 'command'; commandId: string; command: VfCommand }
  | { type: 'clear' }

/** Probe → host events. */
export type VfProbeMessage =
  /** Handshake: probe is mounted and listening. The host adopts this channelId. */
  | { type: 'ready'; channelId: string; version: number }
  | { type: 'selected'; capture: VfCapture }
  /** While a composer is open, the active element rect re-reported on scroll/resize. */
  | { type: 'active-rect'; rect: VfRect | null }
  /** Reply to an agent `command`, keyed by the same `commandId`. */
  | {
      type: 'command-result'
      commandId: string
      ok: boolean
      result?: VfCommandResult
      error?: string
      errorCode?: VfCommandErrorCode
    }
  /** Esc pressed inside the preview (iframe had focus) → the host leaves comment mode. */
  | { type: 'escape' }
  /** A commented element was clicked while commenting: the host opens that comment. */
  | { type: 'open-mark'; id: string; rect: VfRect }
  | { type: 'error'; message: string }
