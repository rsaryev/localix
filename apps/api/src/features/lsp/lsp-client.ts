import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { createThrottle } from '../../lib/debounce'
import { languageIdForPath } from './lsp-languages'
import { createDiagnosticPullCoordinator } from './lsp-diagnostics-coordinator'
import { CLIENT_CAPABILITIES } from './lsp-capabilities'
import { createDiagnosticsSnapshot } from './lsp-diagnostics-snapshot'
import { createEditorFeatures } from './lsp-editor-features'
import {
  configurationValue,
  DIAGNOSTICS_PUBLISH_INTERVAL_MS,
  DIAGNOSTICS_WAIT_TIMEOUT_MS,
  FILE_CHANGE_CHANGED,
  FILE_CHANGE_CREATED,
  fileUri,
  fromFileUri,
  getSyncKind,
  INITIALIZE_TIMEOUT_MS,
  saveIncludesText,
  TEXT_DOCUMENT_SYNC_INCREMENTAL,
  type CapabilityRegistration,
  type DiagnosticRequestResult,
  type DiagnosticsListener,
  type LspClientInfo,
  type LspDiagnostic,
  type ServerCapabilities,
} from './lsp-protocol'
import { killProcessTree, stillRunning } from '../agent-core/tools/bash/process-tree'
import { minimalEdit } from './lsp-incremental'
import { WATCHED_CHANGE_CODE, type LspWatchedFileChange } from './lsp-watched-files'

// Re-export the LSP protocol types + normalizers so the historical `./lsp-client`
// import surface stays stable for every existing importer and test.
export {
  normalizeDocumentHighlights,
  normalizeInlayHints,
  normalizeDocumentColors,
  normalizeDocumentSymbols,
  normalizePrepareRename,
  normalizeSignatureHelp,
  normalizeWorkspaceEdit,
  normalizeTextEdits,
  normalizeCodeActions,
  normalizeRelatedInformation,
  normalizeDiagnostic,
  diagnosticsOverlappingRange,
} from './lsp-protocol'
export type {
  LspClientInfo,
  LspCodeAction,
  LspCodeActionCommand,
  LspColorInfo,
  LspCompletionItem,
  LspDiagnostic,
  LspDocumentHighlight,
  LspDocumentSymbol,
  LspInlayHint,
  LspHoverInfo,
  LspLocation,
  LspPosition,
  LspPrepareRename,
  LspRange,
  LspRelatedInformation,
  LspSignatureHelp,
  LspTextEdit,
  LspFormattingOptions,
  LspWorkspaceEditFile,
  LspWorkspaceSymbol,
} from './lsp-protocol'

export async function createLspClient(input: {
  serverId: string
  process: ChildProcessWithoutNullStreams
  rootDir: string
  initialization?: Record<string, unknown>
  onDiagnosticsUpdate?: (byFile: Record<string, LspDiagnostic[]>) => void
  onReady?: () => void
  onError?: (err: unknown) => void
}): Promise<LspClientInfo | undefined> {
  const { serverId, process: proc, rootDir } = input

  const connection = createMessageConnection(
    new StreamMessageReader(proc.stdout),
    new StreamMessageWriter(proc.stdin),
  )

  const pushDiagnostics = new Map<string, LspDiagnostic[]>()
  const pullDiagnostics = new Map<string, LspDiagnostic[]>()
  const openedFiles = new Map<string, { version: number; text: string }>()
  const diagnosticRegistrations = new Map<string, CapabilityRegistration>()
  let disposed = false
  const diagnosticsDebouncer = createThrottle(DIAGNOSTICS_PUBLISH_INTERVAL_MS)

  // Listeners waiting for diagnostics for a specific file
  const diagnosticsListeners = new Set<DiagnosticsListener>()
  const registrationListeners = new Set<() => void>()

  function notifyDiagnosticsListeners(filePath: string) {
    for (const l of diagnosticsListeners) l(filePath)
  }

  const { buildDiagnosticsSnapshot, mergePullResults } = createDiagnosticsSnapshot(
    pushDiagnostics,
    pullDiagnostics,
    flushDiagnostics,
  )

  function flushDiagnostics() {
    diagnosticsDebouncer.schedule(() => {
      input.onDiagnosticsUpdate?.(buildDiagnosticsSnapshot())
    })
  }

  const requestDiagnostics = createDiagnosticPullCoordinator({
    connection,
    diagnosticRegistrations,
    hasStaticPullDiagnostics: () => hasStaticPullDiagnostics,
    getWorkspacePullInFlight: () => workspacePullInFlight,
    mergePullResults,
  })

  connection.onNotification(
    'textDocument/publishDiagnostics',
    (params: { uri: string; diagnostics: LspDiagnostic[] }) => {
      const filePath = fromFileUri(params.uri)
      if (!filePath) return
      pushDiagnostics.set(filePath, params.diagnostics)
      flushDiagnostics()
      notifyDiagnosticsListeners(filePath)
    },
  )

  connection.onRequest('window/workDoneProgress/create', () => null)
  connection.onRequest('workspace/configuration', (params: unknown) => {
    const items = (params as { items?: { section?: string }[] }).items ?? []
    return items.map((item) => configurationValue(input.initialization, item.section))
  })
  // (Un)register flow is identical: walk the entries, act only on the
  // `textDocument/diagnostic` capability, and notify listeners iff something
  // changed. `apply` does the set/delete; everything else is shared.
  function applyCapabilityChanges<T extends { id: string; method: string }>(
    entries: T[] | undefined,
    apply: (entry: T) => void,
  ): null {
    let changed = false
    for (const entry of entries ?? []) {
      if (entry.method !== 'textDocument/diagnostic') continue
      apply(entry)
      changed = true
    }
    if (changed) for (const listener of registrationListeners) listener()
    return null
  }
  connection.onRequest('client/registerCapability', (params: unknown) =>
    applyCapabilityChanges(
      (params as { registrations?: CapabilityRegistration[] }).registrations,
      (registration) => diagnosticRegistrations.set(registration.id, registration),
    ),
  )
  connection.onRequest('client/unregisterCapability', (params: unknown) =>
    applyCapabilityChanges(
      (params as { unregisterations?: { id: string; method: string }[] }).unregisterations,
      (registration) => diagnosticRegistrations.delete(registration.id),
    ),
  )
  connection.onRequest('workspace/workspaceFolders', () => [
    { uri: fileUri(rootDir), name: path.basename(rootDir) },
  ])
  // The server signals that diagnostics changed (common for pull-based servers
  // after the first post-didOpen analysis settles). Re-pull every open document so
  // the freshly-computed diagnostics actually reach the editor.
  connection.onRequest('workspace/diagnostic/refresh', () => {
    for (const filePath of openedFiles.keys()) void requestDiagnostics(filePath)
    return null
  })
  connection.onNotification('window/logMessage', () => {})
  connection.onNotification('window/showMessage', () => {})
  connection.onNotification('$/progress', () => {})

  // Drain stderr: it is piped (stdio[2]='pipe') but otherwise never consumed,
  // so a chatty server could fill the OS pipe buffer and stall the child.
  proc.stderr?.resume()

  // A spawn failure (missing/non-executable binary) surfaces asynchronously as
  // an 'error' event. With no listener Node re-throws it as an uncaught error
  // and crashes the host process, so handle it here (quiet on intentional dispose).
  proc.on('error', (err) => {
    if (!disposed) input.onError?.(err)
  })

  proc.on('exit', () => {
    if (!disposed) input.onError?.(new Error(`LSP server ${serverId} exited unexpectedly`))
  })

  connection.listen()

  const initPromise = new Promise<{ capabilities: ServerCapabilities } | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), INITIALIZE_TIMEOUT_MS)
    connection
      .sendRequest('initialize', {
        processId: process.pid,
        clientInfo: { name: 'localix', version: '1.0.0' },
        rootUri: fileUri(rootDir),
        workspaceFolders: [{ uri: fileUri(rootDir), name: path.basename(rootDir) }],
        initializationOptions: { ...input.initialization },
        capabilities: CLIENT_CAPABILITIES,
      })
      .then(
        (res: unknown) => {
          clearTimeout(timer)
          resolve(res as { capabilities: ServerCapabilities })
        },
        () => {
          clearTimeout(timer)
          resolve(undefined)
        },
      )
  })

  const initialized = await initPromise
  if (!initialized) {
    // Initialization failed/timed out — tear down the child so it doesn't leak.
    // Mark disposed first so the 'exit' handler above stays quiet.
    disposed = true
    connection.dispose()
    killProcessTree(proc.pid, undefined, stillRunning(proc))
    return undefined
  }

  await connection.sendNotification('initialized', {})
  // Only push settings when there ARE settings. An EMPTY object ({}) is not
  // "no config" — some servers (vscode-json/css) read it as a full settings blob
  // that overrides their defaults and DISABLES validation, so pushing `{}` makes
  // a JSON file with a real syntax error show no diagnostics at all. Servers with
  // no initialization still answer the server-initiated `workspace/configuration`
  // pull (handled below), which is the correct path for defaults.
  if (input.initialization && Object.keys(input.initialization).length > 0) {
    await connection.sendNotification('workspace/didChangeConfiguration', {
      settings: input.initialization,
    })
  }
  input.onReady?.()

  const syncKind = getSyncKind(initialized.capabilities)
  const saveCarriesText = saveIncludesText(initialized.capabilities)
  const hasStaticPullDiagnostics = Boolean(initialized.capabilities?.diagnosticProvider)

  const workspacePullInFlight = new Map<string, Promise<DiagnosticRequestResult>>()

  /** Wait up to `timeout` ms for a diagnostics push for `filePath` */
  function waitForPush(filePath: string, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        diagnosticsListeners.delete(listener)
        resolve(false)
      }, timeout)
      const listener: DiagnosticsListener = (fp) => {
        if (fp === filePath) {
          clearTimeout(timer)
          diagnosticsListeners.delete(listener)
          resolve(true)
        }
      }
      diagnosticsListeners.add(listener)
    })
  }

  async function touchFileAndWait(filePath: string, wait = true): Promise<boolean> {
    if (disposed) return false
    let content: string
    try {
      content = await Bun.file(filePath).text()
    } catch {
      return false
    }
    const alreadyOpen = openedFiles.has(filePath)
    try {
      // Disk path: the content was just READ FROM DISK because it changed there
      // (agent write / patch / formatter), so the watched-file event is genuine.
      return await syncDocumentInternal(filePath, content, wait, true)
    } finally {
      // Agent write diagnostics are a transient disk read, not editor ownership.
      // Leaving every touched file open pins project graphs and diagnostics forever.
      // Version 0 is the transient didOpen issued above. If an editor claimed or
      // changed the document while diagnostics were settling it increments the
      // version, so this call must not close the editor's newer ownership.
      if (!alreadyOpen && openedFiles.get(filePath)?.version === 0)
        await closeDocumentInternal(filePath, false)
    }
  }

  // Shared didOpen/didChange dispatch. Editor navigation only needs the document
  // to exist in the server, while the agent write path must wait for diagnostics;
  // coupling both to the 6s clean-file timeout made early Cmd+Click feel broken.
  async function syncDocumentInternal(
    filePath: string,
    content: string,
    waitForDiagnostics: boolean,
    /**
     * Whether this sync reflects a change to the file ON DISK (an agent write, a
     * patch, a formatter) as opposed to an editor buffer the user is typing into.
     * Only a real disk change may be announced as `workspace/didChangeWatchedFiles`
     * — the spec defines that notification as sent "when the client detects changes
     * to file watched by the language client". A keystroke is not that: the buffer
     * moved, the file did not, and telling the server otherwise makes it invalidate
     * and re-read the path from disk — where it finds the STALE unsaved content —
     * on every 150ms editor sync. `didOpen`/`didChange` are how a buffer is
     * communicated, and they are sent either way.
     */
    diskChanged: boolean,
  ): Promise<boolean> {
    if (disposed) return false

    const languageId = languageIdForPath(filePath)
    const opened = openedFiles.get(filePath)
    const startedAt = Date.now()

    // The strict write/diagnostics path starts waiting BEFORE the notification so
    // it cannot miss a fast push. Editor sync relies on the normal push callback
    // and must not accumulate one 6s timer/listener per keystroke.
    const pushWait = waitForDiagnostics ? waitForPush(filePath, DIAGNOSTICS_WAIT_TIMEOUT_MS) : null

    if (opened === undefined) {
      // New to this server. Only a genuine disk change is announced to the file
      // watcher; an editor opening a buffer says so with didOpen alone.
      if (diskChanged) {
        await connection.sendNotification('workspace/didChangeWatchedFiles', {
          changes: [{ uri: fileUri(filePath), type: FILE_CHANGE_CREATED }],
        })
      }
      await connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri: fileUri(filePath), languageId, version: 0, text: content },
      })
      openedFiles.set(filePath, { version: 0, text: content })
      pushDiagnostics.delete(filePath)
      pullDiagnostics.delete(filePath)
    } else {
      // Already open — fire didChangeWatchedFiles + didChange
      const next = opened.version + 1
      openedFiles.set(filePath, { version: next, text: content })

      if (diskChanged) {
        await connection.sendNotification('workspace/didChangeWatchedFiles', {
          changes: [{ uri: fileUri(filePath), type: FILE_CHANGE_CHANGED }],
        })
      }

      // When the server accepts ranged edits, send the actual DELTA. The previous
      // text is right here, so the whole buffer never has to go back over the wire:
      // measured at 1.04 MB per sync for a 1 MB file, which is what a 150ms typing
      // debounce turns into ~7 MB/s of JSON-RPC. The old "incremental" branch
      // declared a range and then filled it with the entire document, so it cost the
      // same as the full-sync form while claiming not to.
      const delta =
        syncKind === TEXT_DOCUMENT_SYNC_INCREMENTAL ? minimalEdit(opened.text, content) : null
      await connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: fileUri(filePath), version: next },
        contentChanges:
          syncKind === TEXT_DOCUMENT_SYNC_INCREMENTAL
            ? // `null` means the text is unchanged; an empty change list is the
              // correct way to say "this version carries no edit".
              delta
              ? [delta]
              : []
            : [{ text: content }],
      })
    }

    // A disk change IS a save as far as the server can tell — servers that only check on
    // save (rust-analyzer's `cargo check`, some linters) must hear it. An editor keystroke
    // is not: announcing didSave on every buffer sync made those servers start a full
    // check on every pause in typing, against disk bytes that did not hold the edit yet.
    // The editor announces its real saves through `saveDocument`.
    if (diskChanged) await sendDidSave(filePath, content)

    // Wait for the server to push back diagnostics. `true` means the server answered — by a
    // pull report or a push before the deadline; `false` means the deadline paid for nothing.
    const settleDiagnostics = async (): Promise<boolean> => {
      const remaining = DIAGNOSTICS_WAIT_TIMEOUT_MS - (Date.now() - startedAt)
      const pulled = await requestDiagnostics(filePath)
      if (pulled.handled) return true
      if (remaining > 0 && pushWait) return pushWait
      return false
    }
    if (waitForDiagnostics) return settleDiagnostics()
    void settleDiagnostics().catch(() => {})
    return true
  }

  /** Editor path: unblock hover/navigation after didOpen/didChange is dispatched.
   *  The buffer changed, not the file — no watched-file event. */
  async function syncDocument(filePath: string, content: string): Promise<void> {
    await syncDocumentInternal(filePath, content, false, false)
  }

  // The BODY rides along only if the server asked for it: `text` is spec'd as conditional
  // on `save.includeText`, so a server that did not declare it discards the copy while we
  // pay to serialize and ship the whole buffer a second time (didChange already carried it).
  async function sendDidSave(filePath: string, content: string): Promise<void> {
    await connection.sendNotification('textDocument/didSave', {
      textDocument: { uri: fileUri(filePath) },
      ...(saveCarriesText ? { text: content } : {}),
    })
  }

  /** The editor wrote its buffer to disk: announce the save for an open document. */
  async function saveDocument(filePath: string): Promise<void> {
    const opened = openedFiles.get(filePath)
    if (disposed || !opened) return
    await sendDidSave(filePath, opened.text).catch(() => {})
  }

  // Tell the server the editor closed the file: drop its open state and stale
  // diagnostics so a re-open re-syncs cleanly and counts don't leak.
  async function closeDocumentInternal(filePath: string, clearDiagnostics: boolean): Promise<void> {
    if (disposed || !openedFiles.has(filePath)) return
    openedFiles.delete(filePath)
    if (clearDiagnostics) {
      pushDiagnostics.delete(filePath)
      pullDiagnostics.delete(filePath)
    }
    try {
      await connection.sendNotification('textDocument/didClose', {
        textDocument: { uri: fileUri(filePath) },
      })
    } catch {
      /* ignore — server may be gone */
    }
  }

  function closeDocument(filePath: string): Promise<void> {
    return closeDocumentInternal(filePath, true)
  }

  // Disk changes from the workspace watcher (see `lsp-watched-files.ts`). A file this client
  // holds OPEN is left out: its editor buffer is the server's truth (see `syncDocument`'s
  // `diskChanged`), and announcing it would make the server re-read a disk copy that may lack
  // the unsaved edit; the editor reloads it on `fs.changed` and resyncs through didChange.
  async function notifyWatchedFiles(changes: readonly LspWatchedFileChange[]): Promise<void> {
    if (disposed) return
    const closed = changes.filter((change) => !openedFiles.has(change.path))
    if (!closed.length) return
    await connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: closed.map((c) => ({ uri: fileUri(c.path), type: WATCHED_CHANGE_CODE[c.type] })),
    })
  }

  // Editor requests share the connection and read disposal state at call time.
  const features = createEditorFeatures({
    connection,
    capabilities: initialized.capabilities,
    isDisposed: () => disposed,
  })

  function dispose(): void {
    if (disposed) return // guard against double dispose / double kill
    disposed = true
    diagnosticsDebouncer.cancel()
    diagnosticsListeners.clear()
    registrationListeners.clear()
    try {
      void connection.sendRequest('shutdown').catch(() => undefined)
    } catch {
      /* ignore */
    }
    // sendNotification returns a promise; swallow rejection to avoid an unhandled rejection on shutdown.
    try {
      void Promise.resolve(connection.sendNotification('exit')).catch(() => undefined)
    } catch {
      /* ignore */
    }
    try {
      connection.dispose()
    } catch {
      /* ignore */
    }
    killProcessTree(proc.pid, undefined, stillRunning(proc))
  }

  return {
    serverId,
    rootUri: fileUri(rootDir),
    touchFileAndWait,
    syncDocument,
    saveDocument,
    closeDocument,
    hasOpenDocuments: () => openedFiles.size > 0,
    notifyWatchedFiles,
    ...features,
    diagnostics: () => buildDiagnosticsSnapshot(),
    dispose,
  }
}
