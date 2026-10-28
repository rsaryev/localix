/**
 * Capability the `Browser` tool uses to drive the live preview the user
 * has open (snapshot the page, click/type/scroll, screenshot an element, read
 * console). The host is injected (bootstrap → a command registry that relays over
 * the firehose to the open inspector's probe and awaits the reply), so agent-core
 * never imports the chat/preview feature — the dependency arrow stays one-way.
 * Absent → the tool is not registered.
 *
 * Shapes mirror `@localixai/visual-feedback`'s probe protocol but are redeclared
 * here (like `terminal-job.ts`'s `ScreenSnapshot`) so this boundary owns its own
 * contract and pulls in no page-side package.
 */

export type PreviewAction =
  | 'viewport'
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
  | 'history'

export type BrowserHistoryOperation = 'list' | 'search' | 'open' | 'remove' | 'clear'

/** One step inside a `steps` batch: the page-mutating actions PLUS the read actions
 *  `snapshot`/`evaluate`/`console`, so a batch can act THEN observe in one call (a
 *  trailing `snapshot` returns the fresh tree). */
export interface PreviewStep {
  action: 'click' | 'type' | 'press' | 'scroll' | 'hover' | 'snapshot' | 'evaluate' | 'console'
  ref?: string
  selector?: string
  text?: string
  key?: string
  keys?: string[]
  direction?: 'up' | 'down' | 'left' | 'right'
  amount?: number
  /** `evaluate` step: the JS expression to run in the page. */
  expression?: string
}

/** One command the agent issues against the preview. Only `action`-relevant fields are read. */
export interface PreviewCommand {
  previewId?: string
  viewport?: { width: number; height: number } | null
  action: PreviewAction
  /** Target by `eN` ref (from the latest snapshot) — preferred. */
  ref?: string
  /** Target by CSS selector (fallback). */
  selector?: string
  /** `type`: text to insert. */
  text?: string
  /** `press`: key name / chord (`Enter`, `Ctrl+a`). */
  key?: string
  /** `press`: a sequence of keys to send in one call (fewer round-trips). */
  keys?: string[]
  /** `scroll`: direction when not scrolling an element into view. */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** `scroll`: pixels. */
  amount?: number
  /** `snapshot`: interactive nodes only. */
  interactiveOnly?: boolean
  /** `snapshot`: max tree depth. */
  maxDepth?: number
  /** click/type/press/scroll/hover: also return a fresh snapshot of the new page
   *  state in the same call (no separate `snapshot` round-trip). */
  snapshotAfter?: boolean
  /** `steps`: an ordered batch of interactions to run in one call. */
  steps?: PreviewStep[]
  /** `evaluate`: a JS expression run in the page realm; its (awaited) value is returned. */
  expression?: string
  /** App Browser history, not website DOM state. */
  historyOperation?: BrowserHistoryOperation
  historyQuery?: string
  historyUrls?: string[]
}

/** One interactive node of a snapshot, in tree order: what a decision model chooses among. */
export interface PreviewSnapshotElement {
  ref: string
  role: string
  name: string
  /** The control's current value (never a password's). */
  value?: string
  /** `disabled`, `checked`, `expanded`, `selected`… */
  states?: string[]
  /** Takes typed text (a text field, a textarea, an editable combobox). */
  editable?: boolean
  /** Inside an open dialog. */
  dialog?: boolean
}

export interface PreviewSnapshot {
  tree: string
  /** The interactive nodes, ≤250, when the probe lists them (the `goal` action reads these). */
  elements?: PreviewSnapshotElement[]
  stats: { nodes: number; interactive: number; chars: number }
  url: string
  title: string
  /** Page subresources that FAILED to load (stylesheet/script/image 404s), deduped +
   *  capped — present only when non-empty. Surfaces silent page-side breakage. */
  failedResources?: string[]
}

export interface PreviewConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
}

/** An element screenshot the host captured (added on top of the probe result). */
export interface PreviewImage {
  /** base64 (no data: prefix). */
  data: string
  mediaType: string
  width: number
  height: number
}

/** Result payload of a successful command. */
export interface PreviewCommandResult {
  previewId?: string
  viewport?: { width: number; height: number }
  action: PreviewAction
  snapshot?: PreviewSnapshot
  console?: PreviewConsoleEntry[]
  rect?: { x: number; y: number; width: number; height: number } | null
  diff?: string
  target?: string
  note?: string
  /** `screenshot`: the captured image (filled by the host, not the probe). */
  image?: PreviewImage
  /** `evaluate`: the serialized result of the page-realm expression. */
  value?: string
  /** The page reloaded/navigated between the agent's previous command and this one
   *  (DOM reset, prior refs invalid) — the tool prepends an explicit notice. */
  reloaded?: boolean
  /** Console errors/warnings (uncaught throws, unhandled rejections, auto-dismissed
   *  native dialogs) captured DURING a drive action — bounded. The tool renders them
   *  as a ⚠ block so a click whose handler threw isn't read as a silent no-op. */
  recentErrors?: string[]
  /** Subresources that FAILED to load since the previous command, on a diff-only drive
   *  result (the snapshot path uses `snapshot.failedResources`). Bounded; non-empty only. */
  failedResources?: string[]
}

/** Outcome of relaying a command to the open preview. */
export type PreviewSendOutcome =
  | { ok: true; result: PreviewCommandResult }
  | {
      ok: false
      error: string
      /** Probe-level failure reason (re-snapshot / dismiss overlay / bad input). */
      errorCode?:
        | 'not_found'
        | 'intercepted'
        | 'bad_request'
        | 'failed'
        | 'app_disconnected'
        | 'host_unavailable'
        | 'probe_not_ready'
        | 'timeout'
        | 'frame_blocked'
      /** No probe is connected — the user must open + engage the preview tab. */
      notEngaged?: boolean
      /**
       * A partial result the probe attached to a FAILURE — notably a fresh `snapshot`
       * captured when a ref went stale or a target was covered, so the tool can hand
       * the agent current refs in the SAME round-trip (no separate re-snapshot call).
       */
      result?: PreviewCommandResult
    }

/**
 * Relays one command to the preview the given session has open and resolves with
 * the result. Bound to a user + session by the host at wiring time, so the tool
 * only supplies the command.
 *
 * `timeoutMs` overrides the registry's default wait before giving up with
 * `notEngaged` — used for BEST-EFFORT relays (e.g. the snapshot folded into an
 * `open` result) that must not freeze for the full default window when no probe
 * is attached (an unattended/headless run).
 */
export interface PreviewControl {
  send(input: {
    userId: string
    sessionId: string
    command: PreviewCommand
    timeoutMs?: number
  }): Promise<PreviewSendOutcome>
}
