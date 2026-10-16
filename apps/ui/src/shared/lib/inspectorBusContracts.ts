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
  mode: 'write' | 'edit'
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
