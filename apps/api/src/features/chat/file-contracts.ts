/**
 * Response shapes of the session FILE-BROWSER surface (`/rpc/sessions/:id/file*`)
 * — the inspector's viewer/editor, explorer tree, and search panel. Their request
 * schemas live with the other route-local schemas in `routes-schemas.ts`.
 *
 * Kept apart from `contracts.ts`: those are the conversation contracts (sessions,
 * messages, the `AgentStreamEvent` SSE union) and change with the agent runtime,
 * while these change with the IDE surface. `contracts.ts` re-exports them, so the
 * public contract barrel is unchanged.
 */
export interface FileContentResponse {
  path: string
  content: string
  bytes: number
  truncated: boolean
  /** MIME type when the file is a previewable image; absent for plain text/code. */
  mimeType?: string
  /** How `content` is encoded — `base64` for binary images, `utf8` (default) otherwise. */
  encoding?: 'utf8' | 'base64'
  /**
   * sha256 of the (complete) content — the editor's optimistic-concurrency token.
   * Echoed back on save so the server can reject a clobbering write (409). Absent
   * when the read was truncated (a partial buffer must never be saved back).
   */
  hash?: string
  /**
   * Set when the caller supplied a `knownHash` that still matches the file on disk:
   * the body is deliberately empty and `hash`/`bytes` describe the unchanged file.
   * Lets the open editor's reconcile-on-FS-change path confirm "nothing moved"
   * without pulling the whole buffer over the wire again. Never set for a
   * truncated read, which has no hash to compare against.
   */
  unchanged?: true
}

export interface FileWriteResponse {
  /** Absolute, resolved path that was written. */
  path: string
  bytes: number
  /** sha256 of the just-saved content — becomes the editor's new base hash. */
  hash: string
}

export interface DirEntry {
  name: string
  type: 'file' | 'dir'
}

/** Result of creating/renaming a tree entry — the new absolute path + its kind. */
export interface FileEntryResponse {
  path: string
  type: 'file' | 'dir'
}

/** Result of deleting a tree entry. */
export interface FileDeleteResponse {
  path: string
  deleted: true
  /** True when the entry was moved to the trash (reversible) rather than removed
   *  permanently — local backend, non-permanent delete. */
  trashed?: boolean
}

export interface DirListing {
  /** Absolute, resolved directory path (the root when no path was requested). */
  path: string
  entries: DirEntry[]
  /** Number of entries omitted when the directory exceeds the listing cap. Absent
   *  (or 0) means the listing is complete. The UI renders a "… N more items" row. */
  truncated?: number
  /** Whether disk changes reach the tree on their own (a local session with a working watcher).
   *  When false — an ssh/docker session, a watcher in failure backoff — the tree offers a
   *  manual Refresh. */
  live?: boolean
}

/** Result of a file-tree undo (⌘Z) — what was reversed and which dirs to refresh. */
export interface FileUndoResponse {
  undone: boolean
  kind?: 'trash' | 'move'
  /** Directories the UI should re-list to reflect the reversal. */
  affectedDirs?: string[]
  /** Path restored/moved back (so the UI can reveal it). */
  restoredPath?: string
}

/** Match mode for the project file search. */
export type FileSearchMode = 'fuzzy' | 'regex'

/** Which kinds of entries the search should surface. */
export type FileSearchType = 'all' | 'files' | 'folders'

/** A single ranked search hit (project-relative). */
export interface FileSearchEntry {
  /** Project-relative path (forward-slashed). */
  path: string
  /** Basename of the path. */
  name: string
  type: 'file' | 'dir'
}

export interface FileSearchResult {
  /** Absolute resolved project root the entry paths are relative to. */
  root: string
  /** Ranked entries, best-match first (capped by `limit`). */
  files: FileSearchEntry[]
  /** Total matches before pagination (so the UI can show "showing N of M"). */
  count: number
  /**
   * Number of project files left OUT of the searchable index because the tree
   * exceeded the indexing cap. Absent when the whole tree is indexed. Present so a
   * "no results" answer in a huge workspace is distinguishable from a genuine miss
   * — the index used to be tail-truncated silently and there was no way to tell.
   */
  indexTruncated?: number
}

/** A single content (text) match inside a file — backs the search-panel "Text" mode. */
export interface FileContentMatch {
  /** Project-relative path (forward-slashed). */
  path: string
  /** 1-based line number of the match. */
  line: number
  /** The matched line's text (trailing newline stripped, capped for display). */
  lineText: string
  /** Char offset of the match start within `lineText`. */
  matchStart: number
  /** Char offset (exclusive) of the match end within `lineText`. */
  matchEnd: number
  /** Contiguous source lines immediately BEFORE the match (nearest last), when
   *  context lines were requested. Line N of `before` is at `line - before.length + N`. */
  before?: string[]
  /** Contiguous source lines immediately AFTER the match (nearest first), when
   *  context lines were requested. Line N of `after` is at `line + 1 + N`. */
  after?: string[]
}

export interface FileContentSearchResult {
  /** Absolute resolved project root the match paths are relative to. */
  root: string
  /** Matches in file → line order, capped by `limit`. */
  matches: FileContentMatch[]
  /** Number of matches surfaced (== matches.length). */
  count: number
  /** True when the result set was capped at `limit`. */
  truncated: boolean
}
