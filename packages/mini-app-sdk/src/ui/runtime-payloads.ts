/**
 * THE RUNTIME CONTRACT — every type crossing the plugin/host boundary at runtime.
 *
 * Split from `runtime.ts`, which had grown to hold both the vocabulary and the accessors that
 * speak it. They change for different reasons: a new door is a contract edit the host must
 * implement, while an accessor is mechanical forwarding. Keeping them in one file meant every
 * contract review also scrolled past four hundred lines of one-line delegations.
 *
 * `runtime.ts` re-exports all of this, so `@localixai/mini-app-sdk/ui/runtime` is unchanged. The
 * completion payloads live one file further out, in `runtime-completion-payloads.ts`, and are
 * re-exported here for the same reason.
 */
export * from './runtime-completion-payloads'
import type { AgentItem } from '@localixai/agent/agents'
import type { IconComponent, MessageBindingDraft, WorkItemLike } from './contrib'

/** Open a file in the host's code editor, optionally at an exact position (like `code -g file:line:col`). */
/**
 * Open a DIFF in the host's viewer — the door beside {@link MiniAppOpenFileRequest} for a plugin
 * that computed a patch and wants the workbench's own diff surface to render it.
 *
 * `provenance` and `staging` are deliberately opaque: the plugin obtained them from its own backend
 * and hands them straight back, and the host renders them through the slot that owns each. Typing
 * them here would drag a source-control vocabulary into a seam every plugin shares.
 */
/**
 * Every workspace open names the chat its tab belongs to — `useWorkItemSessionId()` in a tab, the
 * `sessionId` prop of a session surface, the session a route or a tool call carries. The host used
 * to fill a missing one with the chat on screen, so a plugin tab kept in the background opened its
 * file, diff or preview in another chat's workspace. The host now refuses a session open that
 * names none.
 */
export interface MiniAppOpenDiffRequest {
  /** The chat whose workspace the diff tab opens in. */
  sessionId: string
  /** Absolute path, or an identity string when `multiFile` is set. */
  path: string
  /** The unified diff text. */
  diff: string
  title?: string
  /** The file is gone — the viewer still shows its old contents but offers no "Open". */
  deleted?: boolean
  /** Agent auto-open: reuse the shared preview slot rather than piling a new tab. */
  ephemeral?: boolean
  /** A raw multi-file patch whose `path` is an identity, sectioned per file by the host. */
  multiFile?: boolean
  /** Absolute repo root, so a `multiFile` patch's relative paths can resolve to real files. */
  rootPath?: string
  /** `diff` stopped at the producer's read cap; the viewer labels it instead of passing it off
   *  as the whole change. */
  truncated?: boolean
  /** Header payload for the host's provenance slot. */
  provenance?: unknown
  /** Payload for the host's interactive-staging slot. */
  staging?: unknown
}

export interface MiniAppOpenFileRequest {
  /** The chat whose workspace the file tab opens in. */
  sessionId: string
  /** Absolute path of the file. */
  path: string
  /** 1-indexed line to reveal and place the cursor on. */
  line?: number
  /** 0-based character within the line. */
  column?: number
  /** 1-indexed end of a range to select instead of only placing the cursor. */
  endLine?: number
  /** 0-based end character of the selection. */
  endColumn?: number
  /**
   * Ask for the built-in CODE editor even when a plugin has registered an editor for this file
   * type.
   *
   * Needed because a registered editor otherwise wins silently: a plugin that owns `.foo` makes
   * every open of a `.foo` file render its own surface, so a caller whose whole intent is "show
   * me the text" — a board asking to open its own board file as code — had no way to say it and
   * got the plugin's canvas back instead. A one-off request: it does not change what the file
   * type opens with next time.
   */
  openWith?: 'builtin'
}

/**
 * Show built HTML in the host's Preview panel — the door beside {@link MiniAppOpenFileRequest} for a
 * plugin whose output is a page rather than a document to read.
 *
 * A PATH, and the same one the editor's own "open preview" for an `.html` file passes: the host
 * serves the file's directory over loopback and attaches the panel through its injecting proxy, so
 * relative links between the built pages work and a republish reveals. Deliberately not a URL and
 * not a directory plus an entry — a plugin does not know what port anything is on, and there is
 * already one way to ask for this.
 */
export interface MiniAppOpenPreviewRequest {
  /** Absolute path of the HTML file to open. Its directory is what gets served, unless `root`
   *  names a wider one. */
  path: string
  title?: string
  /**
   * The session whose Browser tab opens. A plugin view is bound to a session (its work item's
   * scope) and that is the one its export belongs to; defaulting to the ACTIVE chat session put the
   * preview on a different session's panel whenever the two disagreed, and the click did nothing
   * visible.
   */
  sessionId: string
  /**
   * The directory to serve, when `path` sits somewhere BELOW it — a multi-page static export whose
   * pages live at `pricing/index.html`, `about/index.html`, and so on. Serving only `path`'s own
   * directory made every nested page lose its `assets/` and every cross-page link resolve back to
   * itself. Omit for a single standalone file, whose own directory already is the whole preview.
   */
  root?: string
}

export interface MiniAppWorkItemRequest {
  workKind: string
  id: string
  title: string
  /** The chat the tab belongs to. `null` only for a kind registered with `scope: 'global'` (an
   *  app-level surface that reads no session); the host refuses a session kind without one. */
  scope: string | null
  payload?: Record<string, unknown>
  ephemeral?: boolean
  replace?: boolean
}

export interface MiniAppComposerInsert {
  text?: string
  bindings?: MessageBindingDraft[]
  replace?: boolean
  submit?: boolean
  internal?: boolean
  /** The chat whose composer receives the text. Without it the insert went to whichever
   *  composer had focus — another chat's, when the plugin surface belonged to a background one. */
  sessionId: string
  buffer?: boolean
}

/** Read-only workspace state exposed without leaking the host's store implementation. */
export interface MiniAppWorkspaceSnapshot {
  /** Open work items keyed by stable id. */
  items: Readonly<Record<string, WorkItemLike>>
  /**
   * The id of the work item the person is looking at, or null when none is.
   *
   * Without it a plugin can see WHAT is open but not WHICH is in front, so a launcher cannot say
   * "you are already here" — and the only way to learn it was the host's grid store.
   */
  focusedId: string | null
}

/** Vault metadata safe to expose to plugin UI. Secret values never cross this boundary. */
export interface MiniAppSecretReference {
  key: string
  label: string
  reference: string
}

/** Stable subset of a host session that plugin surfaces may observe. */
export interface MiniAppPendingInteraction {
  kind: string
  request: {
    id: string
    title?: string
    payload: unknown
  }
}

export interface MiniAppSession {
  id: string
  title: string
  projectId: string | null
  parentSessionId: string | null
  rootSessionId: string | null
  sessionKind: 'chat' | 'subagent' | 'job' | 'system' | 'member'
  /**
   * Who the conversation is with and what each runs on. A plugin sees the party because a
   * session's model is a property of its participants, not of the session.
   */
  agents: ReadonlyArray<{
    handle: string
    providerConnectionId: string | null
    modelId: string
    reasoningEffort: string
  }>
  runtimeStatus: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  sourceToolCallId: string | null
  isRunning: boolean
  createdAt: number
  updatedAt: number
  messages: Array<{
    role: string
    createdAt?: string
    items?: AgentItem[]
  }>
  pendingInteraction: MiniAppPendingInteraction | null
}

export interface MiniAppTranscriptMessage {
  id: string
  role: 'user' | 'assistant'
  content?: string
  items?: AgentItem[]
}

export interface MiniAppTranscriptActionDestination {
  sessionId: string
  /** The project the session belongs to — every session has one. */
  projectId: string
}

export interface MiniAppTranscriptInput {
  /** The chat the transcript tab opens in — the surface that asked for it. */
  sessionId: string
  id: string
  title: string
  messages: readonly MiniAppTranscriptMessage[]
  foreignTools?: boolean
  action?: MiniAppTranscriptAction
  actions?: readonly MiniAppTranscriptAction[]
}

export interface MiniAppTranscriptAction {
  label: string
  pendingLabel: string
  description?: string
  icon?: IconComponent
  errorLabel?: string
  run(): Promise<MiniAppTranscriptActionDestination | void>
}

export interface MiniAppConversationImport {
  title: string
  messages: readonly MiniAppTranscriptMessage[]
  projectId?: string | null
}

/**
 * Files changed on disk under one chat's workspace, coalesced over a short window.
 *
 * `paths` are ABSOLUTE: each changed entry and the directory that holds it, as the host's watcher
 * reports them (`.git` included, its object store excluded). `null` is the coarse form — too many
 * changes to list, a watcher that restarted, a reconnect that may have missed some — and means
 * "anything may have changed; re-read what you show".
 */
export interface MiniAppWorkspaceChange {
  sessionId: string
  paths: readonly string[] | null
}

/** What the host's raw workspace feed calls; {@link MiniAppWorkspaceChange} is built from it. */
export interface MiniAppWorkspaceWatchHandlers {
  /** One batch from the host watcher: absolute paths, or `null` for the coarse signal. */
  onChange(paths: readonly string[] | null): void
  /**
   * Whether disk changes reach this chat on their own: false for a remote (ssh/docker) session or
   * a watcher in failure backoff. Called once the host has armed the watcher, and again whenever
   * that answer may have changed (a reconnect, a coarse signal).
   */
  onLive(live: boolean): void
}

export interface MiniAppFileContent {
  path: string
  content: string
  bytes: number
  truncated: boolean
  mimeType?: string
  encoding?: 'utf8' | 'base64'
  hash?: string
  unchanged?: true
}

/** Provider-owned node from the same agnostic hierarchy used by the composer @resource picker. */
export interface MiniAppResourceNode {
  uri: string
  label: string
  detail?: string
  hasChildren: boolean
  icon?: string
  group?: string
  notice?: boolean
  navigationOnly?: boolean
  actions?: Array<{ id: string; label: string; kind: 'link' }>
}

export interface MiniAppResourceBrowseResult {
  parent: string | null
  nodes: MiniAppResourceNode[]
  notices: MiniAppResourceNode[]
  total: number
  truncated: boolean
}
