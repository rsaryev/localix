/**
 * THE RUNTIME INTERFACE — the doors a host must implement for plugin UI.
 *
 * Its payload types live beside it in `runtime-payloads.ts`: adding a door is a change the host
 * has to answer, while a payload shape usually is not, and reviewing one should not mean
 * scrolling the other. Both are re-exported from `./ui/runtime`.
 */
export * from './runtime-payloads'
import type { MessageBindingDraft, MessageContextBindingDraft } from './contrib'
import type {
  MiniAppComposerInsert,
  MiniAppConversationImport,
  MiniAppEditPredictionRequest,
  MiniAppEditPredictionResult,
  MiniAppFileContent,
  MiniAppOpenDiffRequest,
  MiniAppOpenFileRequest,
  MiniAppOpenPreviewRequest,
  MiniAppResourceBrowseResult,
  MiniAppSecretReference,
  MiniAppSession,
  MiniAppTextInputCompletion,
  MiniAppTextInputCompletionInput,
  MiniAppTranscriptInput,
  MiniAppWorkItemRequest,
  MiniAppWorkspaceSnapshot,
  MiniAppWorkspaceWatchHandlers,
} from './runtime-payloads'

export interface MiniAppUiRuntime {
  workspace: {
    openWorkItem(request: MiniAppWorkItemRequest): void
    /** Open a file in the host editor at an exact line/column — the native "jump to source" door. */
    openFile(request: MiniAppOpenFileRequest): void
    /** Open a computed patch in the host's diff viewer. */
    openDiff(request: MiniAppOpenDiffRequest): void
    /**
     * Serve a directory of built files and show its entry in the host's Preview panel.
     *
     * Rejects when the file does not exist inside the directory, so a caller can report the reason
     * instead of opening an empty panel.
     */
    openPreview(request: MiniAppOpenPreviewRequest): Promise<void>
    /**
     * Close every tab of this plugin's whose id is `prefix` or a `prefix:` child. A session-scoped
     * tab carries its chat in its id, so say which chats the close reaches: `session` closes that
     * chat's tabs only (the same card id in another chat is a different tab); `everyChat` closes
     * them in every chat — for something app-wide that went away, like a removed connection.
     */
    closeWorkItems(prefix: string, options?: { session?: string; everyChat?: boolean }): void
    focusWorkItem(id: string): void
    openSidebarSection(sectionId: string | null): void
    getSnapshot(): MiniAppWorkspaceSnapshot
    subscribe(listener: () => void): () => void
  }
  composer: {
    insert(request: MiniAppComposerInsert): void
  }
  // Every terminal belongs to a chat: its PTY runs in that chat's workspace and its tab lives in
  // that chat. `null` used to mean "whichever chat is on screen" — or an unbound shell in $HOME.
  terminal: {
    /** Open (or focus) a chat's terminal, without running anything. */
    openPanel(sessionId: string): void
    /**
     * PASTE a command onto the prompt of a chat's terminal — the host opens one if that chat has
     * none and strips any trailing newline. Deliberately not `spawnCommand`: the person reviews
     * the line and presses Enter, so a plugin can offer a command without executing on their
     * behalf.
     */
    paste(request: { sessionId: string; command: string }): void
    openJob(request: { terminalId: string; sessionId: string; title?: string }): void
    spawnCommand(request: {
      command: string
      sessionId: string
      title?: string
    }): Promise<{ terminalId: string }>
  }
  files: {
    /**
     * Announce that these paths changed on disk, so open editors reload them.
     *
     * A plugin that writes through git — staging a hunk, discarding a change — moves files the
     * editor is already showing, and without this the buffer keeps the stale text until the person
     * switches tabs.
     */
    announceReloaded(paths: readonly string[]): void
    saveBlob(filename: string, blob: Blob): Promise<void> | void
    download(path: string, filename: string): Promise<void>
    /**
     * Native file picker. `extensions` (lower-case, no dot) is a HINT for the
     * dialog's own filter — hosts without a native dialog ignore it, and a user
     * can always reach a path another way, so callers must still validate what
     * comes back.
     */
    pickFiles(options?: { extensions?: readonly string[] }): Promise<string[]>
    /**
     * Materialize browser-provided files as canonical host bindings.
     *
     * A desktop host may retain a real filesystem path. Browser and clipboard
     * files have no path, so the host persists their bytes and returns an opaque
     * media-backed file binding instead. Plugins never choose the storage route.
     */
    bindingsFromFiles(files: readonly File[]): Promise<MessageBindingDraft[]>
    /**
     * The real filesystem paths of files dropped from the operating system, in `files` order,
     * when the host knows them (the desktop app); `null` elsewhere. Unlike
     * {@link bindingsFromFiles} it does nothing with them — a dropped folder is not opened as a
     * project — so a surface that only REFERENCES paths (a board) can take them as they are.
     */
    droppedPaths(files: readonly File[]): Promise<{ path: string; isDir: boolean }[] | null>
    read(
      sessionId: string,
      path: string,
      options?: { full?: boolean; knownHash?: string; signal?: AbortSignal },
    ): Promise<MiniAppFileContent>
    /**
     * The raw on-disk change feed of ONE chat's workspace, armed for as long as it is held.
     *
     * A host door rather than a bridge event: the sandboxed iframe tier never receives file paths
     * (`bridge.ts` keeps `fs.changed` off its allow-list), while native workbench UI already runs
     * with the consent of a native backend. Plugins call {@link miniAppFiles.watchWorkspace}, which
     * coalesces this feed; the host only filters by chat and reports liveness.
     */
    watchWorkspace(sessionId: string, handlers: MiniAppWorkspaceWatchHandlers): () => void
  }
  secrets: {
    listReferences(): Promise<MiniAppSecretReference[]>
    set(request: { key: string; value: string }): Promise<void>
  }
  realtime: {
    onFrame(tag: string, handler: (json: string) => void): () => void
    onReconnect(handler: () => void): () => void
    onDisconnect(handler: () => void): () => void
    request(
      payload: Record<string, unknown>,
      options?: { signal?: AbortSignal; timeoutMs?: number },
    ): Promise<unknown>
  }
  // No "active session" here, on purpose: a plugin surface acts for the chat it belongs to
  // (`useWorkItemSessionId()`, a session surface's `sessionId` prop), never for whichever chat is
  // on screen. Reading the active one made a background board wake, insert into and open things
  // in another chat.
  sessions: {
    list(): readonly MiniAppSession[]
    subscribe(listener: () => void): () => void
    stop(sessionId: string): Promise<void>
    interact(requestId: string, action: string, payload: Record<string, unknown>): Promise<void>
    /** Answers with the created session AND the project it landed in (never project-less). */
    importConversation(input: MiniAppConversationImport): Promise<{ id: string; projectId: string }>
    openTranscript(input: MiniAppTranscriptInput): void
  }
  navigation: {
    /** `projectId` omitted ⇒ resolve the session's own project from the workspace. */
    revealSession(sessionId: string, projectId?: string): void
    /** Resolve through the same kind registry used by context chips. The binding's own session
     *  wins; else `sessionId` — the caller's chat, `null` when it has none, in which case a
     *  session-bound target does not open. */
    openBinding(
      binding: MessageContextBindingDraft,
      sessionId: string | null,
    ): boolean | Promise<boolean>
  }
  resources: {
    /** Browse the host's provider registry without exposing providers or backend clients. */
    browse(partial: string, sessionId?: string | null): Promise<MiniAppResourceBrowseResult>
  }
  projects: {
    resolvePath(path: string): Promise<{ id: string }>
    refresh(): Promise<void>
  }
  editor: {
    predictionEnabled(): boolean
    subscribe(listener: () => void): () => void
    predictNextEdit(
      sessionId: string,
      request: MiniAppEditPredictionRequest,
      signal?: AbortSignal,
    ): Promise<MiniAppEditPredictionResult>
  }
  completion: {
    /** A React hook the host provides: ghost-text completion for one plugin text field. */
    useTextInput(input: MiniAppTextInputCompletionInput): MiniAppTextInputCompletion
  }
  clipboard: {
    writeText(text: string): Promise<boolean>
  }
  external: {
    /** Defaults to the app Browser; true requests the system browser (e.g. OAuth). */
    open(url: string, systemBrowser?: boolean): Promise<void> | void
  }
}
