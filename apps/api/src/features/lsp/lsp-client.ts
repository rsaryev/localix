import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { createThrottle } from '../../lib/debounce'
import { createDocumentSync } from './lsp-document-sync'
import { createPushWait } from './lsp-push-wait'
import { applyDiagnosticRegistrations } from './lsp-diagnostic-registrations'
import { createDiagnosticPullCoordinator } from './lsp-diagnostics-coordinator'
import { CLIENT_CAPABILITIES } from './lsp-capabilities'
import { createDiagnosticsSnapshot } from './lsp-diagnostics-snapshot'
import { createEditorFeatures } from './lsp-editor-features'
import { limitRequests, shutDownWithin } from './lsp-client-timeouts'
import {
  configurationValue,
  DIAGNOSTICS_PUBLISH_INTERVAL_MS,
  fileUri,
  fromFileUri,
  getSyncKind,
  INITIALIZE_TIMEOUT_MS,
  saveIncludesText,
  type CapabilityRegistration,
  type DiagnosticRequestResult,
  type LspClientInfo,
  type LspDiagnostic,
  type ServerCapabilities,
} from './lsp-protocol'
import { killProcessTree, stillRunning } from '../../lib/process-tree'

// Re-export the LSP protocol types so the historical `./lsp-client` import surface stays
// stable for every existing importer.
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
  /** The configuration answered and pushed, when it is not `initialization` (a plugin's `settings`). */
  settings?: Record<string, unknown>
  initializeTimeoutMs?: number
  requestTimeoutMs?: number
  shutdownTimeoutMs?: number
  languageIdFor?: (filePath: string) => string | undefined
  onDiagnosticsUpdate?: (byFile: Record<string, LspDiagnostic[]>) => void
  onReady?: () => void
  onError?: (err: unknown) => void
}): Promise<LspClientInfo | undefined> {
  const { serverId, process: proc, rootDir } = input
  const configuration = input.settings ?? input.initialization

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

  const { notifyDiagnosticsListeners, waitForPush, clearListeners } = createPushWait()

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
    return items.map((item) => configurationValue(configuration, item.section))
  })
  connection.onRequest('client/registerCapability', (params: unknown) =>
    applyDiagnosticRegistrations(
      (params as { registrations?: CapabilityRegistration[] }).registrations,
      (registration) => diagnosticRegistrations.set(registration.id, registration),
    ),
  )
  connection.onRequest('client/unregisterCapability', (params: unknown) =>
    applyDiagnosticRegistrations(
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
    const timer = setTimeout(
      () => resolve(undefined),
      input.initializeTimeoutMs ?? INITIALIZE_TIMEOUT_MS,
    )
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
  if (configuration && Object.keys(configuration).length > 0) {
    await connection.sendNotification('workspace/didChangeConfiguration', {
      settings: configuration,
    })
  }
  if (input.requestTimeoutMs) limitRequests(connection, input.requestTimeoutMs)
  input.onReady?.()

  const syncKind = getSyncKind(initialized.capabilities)
  const saveCarriesText = saveIncludesText(initialized.capabilities)
  const hasStaticPullDiagnostics = Boolean(initialized.capabilities?.diagnosticProvider)

  const workspacePullInFlight = new Map<string, Promise<DiagnosticRequestResult>>()

  const { touchFileAndWait, syncDocument, saveDocument, closeDocument, notifyWatchedFiles } =
    createDocumentSync({
      connection,
      openedFiles,
      pushDiagnostics,
      pullDiagnostics,
      syncKind,
      saveCarriesText,
      isDisposed: () => disposed,
      waitForPush,
      requestDiagnostics,
      ...(input.languageIdFor ? { languageIdFor: input.languageIdFor } : {}),
    })

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
    clearListeners()
    if (input.shutdownTimeoutMs) {
      void shutDownWithin(connection, input.shutdownTimeoutMs, () =>
        killProcessTree(proc.pid, undefined, stillRunning(proc)),
      )
      return
    }
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
