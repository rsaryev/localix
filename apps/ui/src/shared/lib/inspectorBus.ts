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

/**
 * Provenance for a diff, as a header strip above it. Its FIELDS are the host's — a session, the
 * model and mode that produced the change, the rationale — because those are facts about a run,
 * not about whatever recorded them.
 */
export interface DiffProvenanceRequest {
  sessionId: string | null
  model?: string
  rationale?: string
  createdAt: string
}

/** Apply-action payload for a conflict `compare` tab (disk ⟷ your edits): plain
 *  DATA (no closures — diff tabs aren't persisted, but they still serialize into
 *  the grid store) so the compare tab can resolve the divergence self-sufficiently
 *  via the same write path the editor's reconcile banner uses. */
export interface DiffConflictActions {
  sessionId: string
  /** Absolute path of the file in conflict (matches the editor's `editPath`). */
  editPath: string
  /** The user's unsaved edits (right/"your edits" side), captured at compare time. */
  edits: string
  /** The current on-disk content (left/"on disk" side). */
  diskContent: string
  /** The disk content's concurrency token — an overwrite must echo it to win the save. */
  diskHash: string
}

/**
 * Every open names the chat its tab belongs to. An open that named none used to be stamped with
 * whatever chat was on screen, so a tool card in a background pane, a terminal link or a plugin
 * opened its file in another chat's workspace. The caller always knows whose content it is.
 */
interface SessionBound {
  sessionId: string
}

export interface OpenFileRequest extends SessionBound {
  path: string
  /** 1-indexed line. */
  line?: number
  /** 0-based character within the line (LSP convention). */
  column?: number
  /** 1-indexed end line; with `endColumn` the editor selects the range. */
  endLine?: number
  endColumn?: number
  /** Agent auto-open (not a user click) — opens into the shared preview slot. */
  ephemeral?: boolean
  /** Single-click preview — reuse the active preview slot (file-tree click-through). */
  replace?: boolean
  /** Distraction-free: maximize the file's group and collapse the workspace chrome. */
  solo?: boolean
  /** Show the built-in code editor even if a plugin registered one for this file type. */
  openWith?: 'builtin'
}

export interface OpenDiffRequest extends SessionBound {
  path: string
  diff: string
  title?: string
  /** The file was deleted — the diff still shows its old contents, but there is
   *  no on-disk file to "Open", so that action is suppressed. */
  deleted?: boolean
  /** Agent auto-open (not a user click) — opens into the shared preview slot. */
  ephemeral?: boolean
  /** Provenance to render above the diff (set for commit diffs that carry a localix note). */
  provenance?: DiffProvenanceRequest
  /** The diff is a raw multi-file patch (e.g. a whole commit) whose `path` is an
   *  identity, NOT an on-disk file — the shell sections it per file (each with its
   *  own "Open" affordance) instead of showing single-file gutter line links. */
  multiFile?: boolean
  /** Absolute repo root, so a `multiFile` patch's repo-relative per-file paths can
   *  resolve to on-disk files for their "Open" actions. */
  rootPath?: string
  /** The producer stopped at its read cap: `diff` is a complete-file prefix, not the whole
   *  change, and the tab says so instead of passing the prefix off as everything. */
  truncated?: boolean
  /** Real on-disk path to drive syntax highlighting + new-side gutter links when
   *  `path` is a SYNTHETIC identity (e.g. a two-file compare). Defaults to `path`. */
  languagePath?: string
  /** Present on a conflict `compare` tab (disk ⟷ your edits) — the tab shell renders
   *  in-place "Keep my edits / Take disk version" apply actions above the diff. */
  conflict?: DiffConflictActions
  /**
   * Turn this diff tab into an interactive line-level view, handed verbatim to whatever fills the
   * `diff.interactive` slot. OPAQUE: what a line can be moved INTO, and what the two sides are
   * called, belongs to the provider — the host only decides that there is a pane here and routes
   * the value to it. Nothing renders when no provider claims the slot.
   */
  staging?: unknown
}

export interface OpenPreviewRequest {
  url: string
  title?: string
  /** Monotonic version from the backend; bumping it forces the preview iframe to reload. */
  version: number
  /** The chat this preview belongs to — its Browser tab is that chat's. */
  sessionId: string
  /** Stable preview identity (URL origin) — dedup key for the re-openable history. */
  previewId?: string
  /** Entry file we auto-serve (e.g. "index.html") — the visual-feedback source anchor. */
  servedFile?: string
  /** Directory the static preview is served from. */
  rootDir?: string
  /** Shell command that started this server — relaunched by the Preview panel if it stops. */
  startCommand?: string
  /** Site refuses iframing — the pane shows its open-in-browser card. */
  frameBlocked?: boolean
}

/**
 * Generic "open a subsystem's grid tab" request. A feature (a container workbench, …)
 * owns its own tab-id formula + payload shape and calls `inspector.openWorkItem`
 * with a registered `workKind`; core stays subsystem-agnostic — it just opens the
 * WorkItem, and the editor-grid renders it via the contributed Component.
 */
export interface OpenWorkItemRequest {
  /** A registered `WorkItemKind` (see `shared/contrib`). */
  workKind: string
  /** Stable tab identity — re-opening the same id focuses instead of duplicating. */
  id: string
  title: string
  /** The chat the tab belongs to — required for a session kind, refused without one
   *  (`resolveOpenScope`). `null` only for an app-level kind, which belongs to no chat. */
  scope: string | null
  payload?: Record<string, unknown>
  /** Agent auto-open into the shared preview slot. */
  ephemeral?: boolean
  /** Reuse the active preview slot rather than piling a new tab. */
  replace?: boolean
}

export interface LiveFileChangeRequest extends SessionBound {
  toolCallId: string
  path?: string
  title: string
  code: string
  mode: 'write' | 'edit' | 'patch'
  startedAt: number
  /** Desktop-only callers may explicitly open the inspector for file mutation streams. */
  forceOpen?: boolean
}

export type InspectorRequest =
  | ({ kind: 'file' } & OpenFileRequest)
  /** A STORED (dropped/uploaded) file, opened by its media content id — no on-disk path. */
  | { kind: 'media-file'; sessionId: string; mediaId: string; name: string }
  // The request itself, not a field-by-field restatement: the copy drifted the moment
  // `OpenDiffRequest` gained a field, and the mapping silently dropped it.
  | ({ kind: 'diff' } & OpenDiffRequest)
  | ({ kind: 'preview' } & OpenPreviewRequest)
  /** Agent closed the preview (`browser action="close"`) — close the
   *  matching tab, or all of the session's preview tabs when `previewId` is absent. */
  | { kind: 'close-preview'; sessionId: string; previewId?: string }
  /** A chat session was deleted — close its grid tab(s) so no dead tab lingers. */
  | { kind: 'close-session'; sessionId: string }
  | { kind: 'live-file-change'; change: LiveFileChangeRequest }
  | { kind: 'clear-live-file-change'; toolCallId: string }
  | {
      kind: 'terminal'
      sessionId: string
      mode?: 'reuse' | 'new'
      /** Run this instead of an interactive shell (a terminal profile). Implies `mode: 'new'`. */
      command?: string
      title?: string
    }
  | { kind: 'stats' }
  | { kind: 'settings' }
  /** Focus an exact already-mounted grid tab without reconstructing its payload. */
  | { kind: 'focus-work-item'; id: string }
  /** Open (or focus) a subsystem-contributed grid tab (a container workbench, …). */
  | ({ kind: 'work-item' } & OpenWorkItemRequest)
  /** Close every subsystem-contributed grid tab whose id equals or is prefixed by
   *  `prefix` (e.g. all of one db connection's `db-console:<id>[:…]` tabs when it is
   *  removed). Generic — the calling subsystem owns the id/prefix grammar. `session` narrows it
   *  to that chat's tabs; `everyChat` reaches the tabs of every chat (an app-wide thing went away). */
  | { kind: 'close-work-items'; prefix: string; session?: string; everyChat?: boolean }
  /** Mirror a chat message's tool outputs (bash/diffs/…) in the Snapshot tab. */
  | {
      kind: 'message-replay'
      sessionId: string
      messageId: string
      section?: MessageFocusSection
    }
  /** Open (or focus) a chat's Search tab; optional seed query. */
  | { kind: 'global-search'; sessionId: string; query?: string; scope?: string }

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
 * a direct user action (an agent edit, a preview coming up)
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
