import type {
  VfCapture,
  VfCommand,
  VfCommandResult,
  VfImage,
  VfMark,
  VfMode,
  VfRect,
} from '@localixai/visual-feedback/protocol'

/** The host side of the visual-feedback bridge as its consumers see it (`useVisualFeedback`). */

/** Reply from the probe after running one agent command (or a host-side short-circuit). */
export interface VfCommandReply {
  ok: boolean
  result?: VfCommandResult
  error?: string
  errorCode?: 'not_found' | 'intercepted' | 'bad_request' | 'failed'
  /** Set by the host when no probe is connected — nothing executed. */
  notEngaged?: boolean
}

export interface VisualFeedbackBridge {
  /** Probe handshaked at least once (per current iframe load). */
  connected: boolean
  mode: VfMode
  /** A just-picked element awaiting a note (drives the host composer). */
  pending: { capture: VfCapture; rect: VfRect } | null
  setMode: (mode: VfMode) => void
  clearPending: () => void
  /** Quietly highlight every element that already carries a comment (re-sent on reconnect). */
  setMarks: (marks: VfMark[]) => void
  /** A commented element the person clicked in the page: the comment to open, and where. */
  openedMark: { id: string; rect: VfRect } | null
  clearOpenedMark: () => void
  /** Call on iframe `load`: the old probe is gone until the new page handshakes. */
  notifyReload: () => void
  /** Scroll a saved comment's element into view + highlight it (clicked in the list). */
  reveal: (selector: string) => void
  /** Agent-driven control: run one command against the probe, resolving with its result. */
  runCommand: (commandId: string, command: VfCommand) => Promise<VfCommandReply>
  /** Resolve true once the probe is connected (immediately if already), false on timeout. */
  whenConnected: (timeoutMs?: number) => Promise<boolean>
  /** Rasterize one element (by selector) in-page → JPEG, no screen-share permission. */
  captureElement: (selector: string) => Promise<VfImage | null>
}
