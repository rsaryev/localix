/**
 * One-way request channel for revealing things in the inspector panel.
 *
 * Sibling features (e.g. chat tool cards) need to open a file / diff / preview in
 * the inspector, but must not import the inspector feature directly — that would
 * couple two slices on the same layer. Instead they call `inspector.openFile(…)`
 * from this shared module; the editor grid registers a single handler on init. The
 * dependency arrow stays one-directional: chat → shared ← editor grid.
 */

import { recordNavigation, setNavRevealer } from './navHistory'
import type { MessageFocusSection } from './messageFocusBus'

import type {
  OpenFileRequest,
  OpenDiffRequest,
  OpenPreviewRequest,
  OpenWorkItemRequest,
  LiveFileChangeRequest,
  InspectorRequest,
} from './inspectorBusContracts'

export type {
  DiffProvenanceRequest,
  DiffConflictActions,
  OpenFileRequest,
  OpenDiffRequest,
  OpenPreviewRequest,
  OpenWorkItemRequest,
  LiveFileChangeRequest,
  InspectorRequest,
} from './inspectorBusContracts'

type Handler = (request: InspectorRequest) => void
let handler: Handler | null = null
let isOpenReader: (() => boolean) | null = null
const openListeners = new Set<() => void>()

/** The inspector registers its handler once; returns an unsubscribe for HMR/teardown. */
export function registerInspectorHandler(
  next: Handler,
  options?: { isOpen?: () => boolean },
): () => void {
  handler = next
  isOpenReader = options?.isOpen ?? null
  notifyInspectorOpenChange()
  return () => {
    if (handler === next) {
      handler = null
      isOpenReader = null
      notifyInspectorOpenChange()
    }
  }
}

export function notifyInspectorOpenChange(): void {
  openListeners.forEach((listener) => listener())
}

/**
 * Whether an inspector handler is registered — i.e. `inspector.openFile(…)` and the
 * other imperative reveals will actually land rather than no-op. Distinct from
 * `inspector.isOpen()` (panel visibility): the handler can be mounted while the
 * panel is closed. Registration toggles fire `subscribeOpenChange`, so callers that
 * must open the moment the UI is ready can poll this from that subscription (e.g. a
 * cold-launch deep link that arrives before ChatPage mounts).
 */
export function isInspectorReady(): boolean {
  return handler != null
}

/**
 * Auto-reveal policy — the ONE place that decides whether a reveal NOT initiated by
 * a direct user action (an agent's explicit open, a preview coming up)
 * is allowed to touch the inspector.
 *
 * Rule: a non-user reveal lands ONLY when the panel is ALREADY open — so we switch
 * to the relevant tab when the user is looking, but never pop the inspector over the
 * chat and steal focus. Pass `important: true` for the rare terminal/blocking
 * outcome that should surface even into a closed panel.
 *
 * User-initiated reveals (button clicks, keyboard) bypass this and call the
 * imperative `open*` methods directly — the user asked, so always open. Every
 * caller that reveals on an EVENT should funnel through here instead of repeating
 * its own `if (!inspector.isOpen()) return` guard, so the focus-stealing policy
 * stays defined once and scales to new surfaces.
 */
export function autoReveal(request: InspectorRequest, opts?: { important?: boolean }): void {
  if (!inspector.isOpen() && !opts?.important) return
  handler?.(request)
}

/** Request the inspector reveal something. No-ops until a handler is registered. */
export const inspector = {
  /** Open a file in the chat the request names. When an end position is given the editor
   *  selects [start, end] (e.g. a diagnostic's exact range), otherwise it places the cursor. */
  openFile: (request: OpenFileRequest) => {
    handler?.({ kind: 'file', ...request })
    // Record the visited location for the Back/Forward navigation stack. This is
    // the single chokepoint every file reveal funnels through; a back/forward
    // reveal suppresses its own re-record inside navHistory.
    recordNavigation({
      sessionId: request.sessionId,
      path: request.path,
      line: request.line,
      column: request.column,
    })
  },
  /**
   * Open a STORED file (dropped/uploaded, materialized in the media store) in the
   * matching viewer by its content id — no on-disk path. Routed like `openFile` but
   * the viewer loads bytes via `mediaId` (PDF served directly, office/spreadsheet
   * re-extracted). `name` drives the tab title + extension→viewer routing. Not
   * recorded in the file-nav history (there's no path to navigate back to).
   */
  openMediaFile: (request: { sessionId: string; mediaId: string; name: string }) =>
    handler?.({ kind: 'media-file', ...request }),
  openDiff: (request: OpenDiffRequest) => handler?.({ kind: 'diff', ...request }),
  openPreview: (request: OpenPreviewRequest) => handler?.({ kind: 'preview', ...request }),
  /** Close the session's preview tab(s). Pass a previewId to close just that one;
   *  omit it to close all of the session's preview tabs (agent action="close"). */
  closePreview: (sessionId: string, previewId?: string) =>
    handler?.({ kind: 'close-preview', sessionId, previewId }),
  /** Close a deleted session's grid tab(s) so no dead tab is left behind. */
  closeSession: (sessionId: string) => handler?.({ kind: 'close-session', sessionId }),
  /** Whether the registered reveal surface is open; the editor grid is always open. */
  isOpen: () => isOpenReader?.() ?? false,
  subscribeOpenChange: (listener: () => void) => {
    openListeners.add(listener)
    return () => openListeners.delete(listener)
  },
  /** Stream an in-progress file mutation into the inspector, if it is already open. */
  showLiveFileChange: (change: LiveFileChangeRequest) =>
    handler?.({ kind: 'live-file-change', change }),
  clearLiveFileChange: (toolCallId: string) =>
    handler?.({ kind: 'clear-live-file-change', toolCallId }),
  /** Open an interactive terminal tab for a chat session's workspace. */
  openTerminal: (
    sessionId: string,
    options?: {
      mode?: 'reuse' | 'new'
      /** Run a program instead of a shell — see the `command` note on the request type. */
      command?: string
      title?: string
    },
  ) =>
    handler?.({
      kind: 'terminal',
      sessionId,
      ...(options?.mode ? { mode: options.mode } : {}),
      ...(options?.command ? { command: options.command } : {}),
      ...(options?.title ? { title: options.title } : {}),
    }),
  /** Open the Usage & Spend panel (token/cost breakdown). */
  openStats: () => handler?.({ kind: 'stats' }),
  /** Open the Settings tab — lands in the editor role group like the other viewlets. */
  openSettings: () => handler?.({ kind: 'settings' }),
  /** Focus an existing grid tab by exact id. Never creates or mutates a WorkItem. */
  focusWorkItem: (id: string) => handler?.({ kind: 'focus-work-item', id }),
  /** Open (or focus) a subsystem-contributed grid tab. The calling feature owns the
   *  `workKind` (a registered WorkItemKind), the tab-id formula, and the payload
   *  shape — core just opens it. Keeps the inspector bus subsystem-agnostic. */
  openWorkItem: (request: OpenWorkItemRequest) => handler?.({ kind: 'work-item', ...request }),
  /** Close every subsystem-contributed tab whose id equals or is prefixed by `prefix`
   *  (the subsystem owns the prefix grammar). Used e.g. to drop all of a removed db
   *  connection's console tabs. `session` closes only that chat's tabs; `everyChat` closes them
   *  in every chat; with neither, only tabs whose id is exactly the prefix's family. */
  closeWorkItems: (prefix: string, options: { session?: string; everyChat?: boolean } = {}) =>
    handler?.({
      kind: 'close-work-items',
      prefix,
      ...(options.session !== undefined ? { session: options.session } : {}),
      ...(options.everyChat ? { everyChat: true } : {}),
    }),
  /** Open the unified Activity panel for one message, optionally focused on its sources. */
  openMessageReplay: (
    sessionId: string,
    messageId: string,
    section: MessageFocusSection = 'activity',
  ) => handler?.({ kind: 'message-replay', sessionId, messageId, section }),
  /** Open (or focus) a chat's Search tab; pass a query to seed it. */
  openGlobalSearch: (sessionId: string, query?: string, scope?: string) =>
    handler?.({
      kind: 'global-search',
      sessionId,
      query,
      ...(scope ? { scope } : {}),
    }),
}

// The Back/Forward navigation stack reveals a remembered location by re-opening
// the file — route that through the same `openFile` chokepoint (navHistory
// suppresses the re-record so stepping doesn't grow the stack).
setNavRevealer((loc) =>
  inspector.openFile({
    sessionId: loc.sessionId,
    path: loc.path,
    line: loc.line,
    ...(loc.column !== undefined ? { column: loc.column } : {}),
  }),
)
