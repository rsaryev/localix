/**
 * The host-bound runtime ACCESSORS — one delegating call each, over the contract in
 * `runtime-contracts.ts`. Re-exported here so the published `./ui/runtime` subpath keeps its whole
 * surface; import either file, they name the same things.
 */
export * from './runtime-contracts'
import type { MessageBindingDraft, MessageContextBindingDraft } from './contrib'
import type {
  PluginComposerInsert,
  PluginConversationImport,
  PluginEditPredictionRequest,
  PluginEditPredictionResult,
  PluginFileContent,
  PluginOpenDiffRequest,
  PluginOpenFileRequest,
  PluginOpenPreviewRequest,
  PluginResourceBrowseResult,
  PluginSecretReference,
  PluginSession,
  PluginTextInputCompletion,
  PluginTextInputCompletionInput,
  PluginTranscriptInput,
  PluginWorkItemRequest,
  PluginWorkspaceChange,
  PluginWorkspaceSnapshot,
  PluginUiRuntime,
} from './runtime-contracts'
import { RESERVED_FRAME_TAGS } from '../ws-frame-tags'
import { createWorkspaceChangeCoalescer } from './workspace-changes'

let runtime: PluginUiRuntime | null = null

/**
 * Bind the host runtime; the returned unbind RESTORES whatever was bound before.
 *
 * Clearing to null instead let one binding erase another it had shadowed: a test double bound
 * over the host runtime (which a module binds once, at first import) left nothing bound when it
 * unbound, and every later suite in the process met "not bound by the host". A binding is a
 * scope, so ending it returns to the enclosing one. An unbind of a binding already replaced by a
 * newer one changes nothing.
 */
export function bindPluginUiRuntime(next: PluginUiRuntime): () => void {
  const previous = runtime
  runtime = next
  return () => {
    if (runtime === next) runtime = previous
  }
}

function currentRuntime(): PluginUiRuntime {
  if (!runtime) throw new Error('Plugin UI runtime is not bound by the host')
  return runtime
}

function pluginDownloadPath(path: string): string {
  if (!path.startsWith('/rpc/') || path.startsWith('//')) {
    throw new Error(`Plugin downloads must use a relative /rpc/* path: ${path}`)
  }
  return path
}

export const pluginWorkspace = {
  openWorkItem: (request: PluginWorkItemRequest): void =>
    currentRuntime().workspace.openWorkItem(request),
  openFile: (request: PluginOpenFileRequest): void => currentRuntime().workspace.openFile(request),
  openDiff: (request: PluginOpenDiffRequest): void => currentRuntime().workspace.openDiff(request),
  openPreview: (request: PluginOpenPreviewRequest): Promise<void> =>
    currentRuntime().workspace.openPreview(request),
  closeWorkItems: (prefix: string, options?: { session?: string; everyChat?: boolean }): void =>
    currentRuntime().workspace.closeWorkItems(prefix, options),
  focusWorkItem: (id: string): void => currentRuntime().workspace.focusWorkItem(id),
  openSidebarSection: (sectionId: string | null): void =>
    currentRuntime().workspace.openSidebarSection(sectionId),
  getSnapshot: (): PluginWorkspaceSnapshot => currentRuntime().workspace.getSnapshot(),
  subscribe: (listener: () => void): (() => void) => currentRuntime().workspace.subscribe(listener),
}

export const pluginComposer = {
  insert: (request: PluginComposerInsert): void => currentRuntime().composer.insert(request),
}

export const pluginTerminal = {
  openPanel: (sessionId: string): void => currentRuntime().terminal.openPanel(sessionId),
  paste: (request: { sessionId: string; command: string }): void =>
    currentRuntime().terminal.paste(request),
  openJob: (request: { terminalId: string; sessionId: string; title?: string }): void =>
    currentRuntime().terminal.openJob(request),
  spawnCommand: (request: {
    command: string
    sessionId: string
    title?: string
  }): Promise<{ terminalId: string }> => currentRuntime().terminal.spawnCommand(request),
}

export const pluginFiles = {
  announceReloaded: (paths: readonly string[]): void =>
    currentRuntime().files.announceReloaded(paths),
  saveBlob: (filename: string, blob: Blob): Promise<void> =>
    Promise.resolve(currentRuntime().files.saveBlob(filename, blob)),
  download: (path: string, filename: string): Promise<void> =>
    currentRuntime().files.download(pluginDownloadPath(path), filename),
  pickFiles: (options?: { extensions?: readonly string[] }): Promise<string[]> =>
    currentRuntime().files.pickFiles(options),
  bindingsFromFiles: (files: readonly File[]): Promise<MessageBindingDraft[]> =>
    currentRuntime().files.bindingsFromFiles(files),
  droppedPaths: (files: readonly File[]): Promise<{ path: string; isDir: boolean }[] | null> =>
    currentRuntime().files.droppedPaths(files),
  read: (
    sessionId: string,
    path: string,
    options?: { full?: boolean; knownHash?: string; signal?: AbortSignal },
  ): Promise<PluginFileContent> => currentRuntime().files.read(sessionId, path, options),
  /**
   * Hear about on-disk changes under one chat's workspace — a terminal `git switch`, an editor
   * save, an agent's write — instead of polling for them. Batches are coalesced over `windowMs`
   * (`workspace-changes.ts`); `onLive` says whether the signal reaches this chat at all, so a
   * caller keeps a slow backstop poll and runs it fast only when it does not (a remote session).
   * A host with no watcher answers `onLive(false)` and never calls `listener`. Returns the
   * unsubscribe.
   */
  watchWorkspace: (
    sessionId: string,
    listener: (change: PluginWorkspaceChange) => void,
    options: { windowMs?: number; onLive?: (live: boolean) => void } = {},
  ): (() => void) => {
    const files: Partial<PluginUiRuntime['files']> | undefined = currentRuntime().files
    if (!files?.watchWorkspace) {
      options.onLive?.(false)
      return () => {}
    }
    const coalescer = createWorkspaceChangeCoalescer(sessionId, listener, options.windowMs)
    const off = files.watchWorkspace(sessionId, {
      onChange: (paths) => coalescer.push(paths),
      onLive: (live) => options.onLive?.(live),
    })
    return () => {
      coalescer.close()
      off()
    }
  },
}

export const pluginSecrets = {
  listReferences: (): Promise<PluginSecretReference[]> => currentRuntime().secrets.listReferences(),
  set: (request: { key: string; value: string }): Promise<void> =>
    currentRuntime().secrets.set(request),
}

function pluginFrameTag(tag: string): string {
  if (!/^[a-z]$/.test(tag) || RESERVED_FRAME_TAGS.has(tag)) {
    throw new Error(`Plugin realtime frame tag must be one lowercase non-core character: ${tag}`)
  }
  return tag
}

export const pluginRealtime = {
  onFrame: (tag: string, handler: (json: string) => void): (() => void) =>
    currentRuntime().realtime.onFrame(pluginFrameTag(tag), handler),
  onReconnect: (handler: () => void): (() => void) =>
    currentRuntime().realtime.onReconnect(handler),
  onDisconnect: (handler: () => void): (() => void) =>
    currentRuntime().realtime.onDisconnect(handler),
  request: <T = unknown>(
    payload: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> => currentRuntime().realtime.request(payload, options) as Promise<T>,
}

export const pluginSessions = {
  list: (): readonly PluginSession[] => currentRuntime().sessions.list(),
  subscribe: (listener: () => void): (() => void) => currentRuntime().sessions.subscribe(listener),
  stop: (sessionId: string): Promise<void> => currentRuntime().sessions.stop(sessionId),
  interact: (requestId: string, action: string, payload: Record<string, unknown>): Promise<void> =>
    currentRuntime().sessions.interact(requestId, action, payload),
  importConversation: (
    input: PluginConversationImport,
  ): Promise<{ id: string; projectId: string }> =>
    currentRuntime().sessions.importConversation(input),
  openTranscript: (input: PluginTranscriptInput): void =>
    currentRuntime().sessions.openTranscript(input),
}

export const pluginNavigation = {
  revealSession: (sessionId: string, projectId?: string): void =>
    currentRuntime().navigation.revealSession(sessionId, projectId),
  openBinding: (binding: MessageContextBindingDraft, sessionId: string | null): Promise<boolean> =>
    Promise.resolve(currentRuntime().navigation.openBinding(binding, sessionId)),
}

export const pluginResources = {
  browse: (partial: string, sessionId?: string | null): Promise<PluginResourceBrowseResult> =>
    currentRuntime().resources.browse(partial, sessionId),
}

export const pluginProjects = {
  resolvePath: (path: string): Promise<{ id: string }> =>
    currentRuntime().projects.resolvePath(path),
  refresh: (): Promise<void> => currentRuntime().projects.refresh(),
}

export const pluginEditor = {
  predictionEnabled: (): boolean => currentRuntime().editor.predictionEnabled(),
  subscribe: (listener: () => void): (() => void) => currentRuntime().editor.subscribe(listener),
  predictNextEdit: (
    sessionId: string,
    request: PluginEditPredictionRequest,
    signal?: AbortSignal,
  ): Promise<PluginEditPredictionResult> =>
    currentRuntime().editor.predictNextEdit(sessionId, request, signal),
}

export const pluginCompletion = {
  useTextInput: (input: PluginTextInputCompletionInput): PluginTextInputCompletion =>
    currentRuntime().completion.useTextInput(input),
}

export const pluginClipboard = {
  writeText: (text: string): Promise<boolean> => currentRuntime().clipboard.writeText(text),
}

function safeExternalUrl(value: string): string {
  const url = new URL(value)
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
    throw new Error(`Plugin external URLs must use http, https, mailto, or tel: ${url.protocol}`)
  }
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.host) {
    throw new Error('Plugin browser URLs must include a host')
  }
  if ((url.protocol === 'mailto:' || url.protocol === 'tel:') && !url.pathname) {
    throw new Error(`Plugin ${url.protocol.slice(0, -1)} URLs must include a destination`)
  }
  return url.toString()
}

export const pluginExternal = {
  open: (url: string, systemBrowser = false): Promise<void> =>
    Promise.resolve(currentRuntime().external.open(safeExternalUrl(url), systemBrowser)),
}
