import { createLspClient, type LspDiagnostic } from './lsp-client'
import { getServersForFile, type LspServerDef } from './lsp-servers'
import { createLspManagerQueries } from './lsp-manager-queries'
import { createServerStartup } from './lsp-server-startup'
import type { ManagedClient } from './lsp-managed-client'
import { createIdleEviction } from './lsp-idle-eviction'
import { createProjectOperations } from './lsp-project-operations'
import { createProjectDiagnostics } from './lsp-project-diagnostics'
import { createDiagnosticsWait, SILENT_COOLDOWN_MS } from './lsp-diagnostics-wait'
import { matchingLspServers } from './lsp-server-match'
import { buildInlineDiagnostics } from './diagnostics-report'
import { notifyWatchedFiles } from './lsp-watched-files'
import { killProcessTree, stillRunning } from '../agent-core/tools/bash/process-tree'
import type { LspManager, LspServerState } from './lsp-manager-types'
import type { LspHealthObserver } from '../notifications/conditions/lsp'
import type { LspInstaller } from './lsp-installer'

// Manager interface + server-state types live in ./lsp-manager-types; re-exported
// here so the historical `./lsp-manager` import surface stays unchanged.
export type { LspManager, LspServerState, LspServerStatus } from './lsp-manager-types'

export const LSP_IDLE_TIMEOUT_MS = 5 * 60_000

interface LspManagerOptions {
  idleTimeoutMs?: number
  /** Test seam for the silent-project cooldown; production keeps SILENT_COOLDOWN_MS. */
  silentCooldownMs?: number
  createClient?: typeof createLspClient
  /** A server that crashed or failed to start, as a standing Event Center row until it is ready. */
  health?: LspHealthObserver
  /** Fetches a built-in server on first use when nothing local provides it. */
  installer?: LspInstaller
  now?: () => number
}

export function createLspManager(options: LspManagerOptions = {}): LspManager {
  const idleTimeoutMs = options.idleTimeoutMs ?? LSP_IDLE_TIMEOUT_MS
  const silentCooldownMs = options.silentCooldownMs ?? SILENT_COOLDOWN_MS
  const createClient = options.createClient ?? createLspClient
  // projectRoot → key → ManagedClient
  const byProject = new Map<string, Map<string, ManagedClient>>()
  // projectRoot → key → startup promise
  const startingMap = new Map<string, Map<string, Promise<void>>>()
  // Spawned processes whose JSON-RPC initialization has not settled yet. Keeping
  // these separately lets dispose kill them immediately rather than waiting for a
  // hung initialize timeout to return a client handle.
  const startingProcesses = new Map<string, { pid?: number; exitCode?: number | null }>()
  // projectRoot → plugin-contributed server defs (CC lspServers, enabled plugins only)
  const pluginServers = new Map<string, LspServerDef[]>()
  const updateHandlers = new Set<(projectRoot: string, states: LspServerState[]) => void>()
  let disposed = false

  const { clearIdleTimer, armIdleEviction } = createIdleEviction({
    idleTimeoutMs,
    isDisposed: () => disposed,
    isStarting: (root, key) => startingMap.get(root)?.has(key),
    getClients: (root) => byProject.get(root),
    deleteProject: (root) => {
      byProject.delete(root)
    },
    notifyUpdate,
  })

  /** Built-in servers for a file, then any plugin-contributed servers registered for this root. */
  function candidateServers(filePath: string, projectRoot: string): LspServerDef[] {
    const builtins = getServersForFile(filePath)
    const extra = pluginServers.get(projectRoot)
    if (!extra?.length) return builtins
    const matched = matchingLspServers(extra, filePath)
    return [...builtins, ...matched]
  }

  function projectClients(projectRoot: string): Map<string, ManagedClient> {
    if (!byProject.has(projectRoot)) byProject.set(projectRoot, new Map())
    return byProject.get(projectRoot)!
  }

  function projectStarting(projectRoot: string): Map<string, Promise<void>> {
    if (!startingMap.has(projectRoot)) startingMap.set(projectRoot, new Map())
    return startingMap.get(projectRoot)!
  }

  const { computeStates, collectDiagnostics } = createProjectDiagnostics((root) =>
    byProject.get(root),
  )

  function notifyUpdate(projectRoot: string) {
    const states = computeStates(projectRoot)
    for (const h of updateHandlers) h(projectRoot, states)
  }

  const ensureServer = createServerStartup({
    createClient,
    startingProcesses,
    isDisposed: () => disposed,
    getHealth: () => options.health,
    candidateServers,
    projectClients,
    projectStarting,
    clearIdleTimer,
    armIdleEviction,
    notifyUpdate,
    ...(options.installer ? { installer: options.installer } : {}),
    now: options.now ?? Date.now,
  })

  // Write-path twin of withReadyClient: start the server if needed, run a
  // document-push call once it's ready, then refresh cached diagnostics + notify.
  // The touch (disk) and sync (editor buffer) paths differ only in the client call.
  async function pushDocument<T>(
    filePath: string,
    projectRoot: string,
    push: (client: NonNullable<ManagedClient['client']>) => Promise<T>,
  ): Promise<T | undefined> {
    const mc = await ensureServer(filePath, projectRoot)
    // Installing: the buffer is opened once the server is ready (`lsp-server-startup.ts`).
    if (mc?.status === 'installing') {
      ;(mc.pending ??= new Map()).set(filePath, push)
      return undefined
    }
    if (mc?.client && mc.status === 'ready') {
      try {
        return await push(mc.client).catch(() => undefined)
      } finally {
        mc.diagnostics = mc.client.diagnostics()
        notifyUpdate(projectRoot)
        const key = `${mc.serverId}:${mc.rootDir}`
        armIdleEviction(projectRoot, key, mc)
      }
    }
    return undefined
  }

  const touchAndWait = createDiagnosticsWait(pushDocument, silentCooldownMs)

  /** Push EDITOR buffer content for a file and wait for diagnostics (editor path). */
  async function syncDocument(
    filePath: string,
    projectRoot: string,
    content: string,
  ): Promise<LspDiagnostic[]> {
    await pushDocument(filePath, projectRoot, (c) => c.syncDocument(filePath, content))
    return collectDiagnostics(projectRoot)[filePath] ?? []
  }

  // Shared path for the position/document query methods (hover, completion,
  // definition, references, signatureHelp, documentSymbols): start the server if
  // needed, and when it's ready delegate to the client call — falling back to
  // `fallback` on no-server / not-ready / a rejected client call.
  async function withReadyClient<T>(
    filePath: string,
    projectRoot: string,
    fallback: T,
    call: (client: NonNullable<ManagedClient['client']>) => Promise<T>,
  ): Promise<T> {
    const mc = await ensureServer(filePath, projectRoot)
    if (mc?.client && mc.status === 'ready') {
      try {
        return await call(mc.client).catch(() => fallback)
      } finally {
        armIdleEviction(projectRoot, `${mc.serverId}:${mc.rootDir}`, mc)
      }
    }
    return fallback
  }

  const { saveDocument, closeDocument, workspaceSymbols } = createProjectOperations({
    getClients: (root) => byProject.get(root),
    clearIdleTimer,
    armIdleEviction,
    notifyUpdate,
  })

  return {
    async reportFileDiagnostics(filePaths, projectRoot) {
      // Touch every changed file in parallel and wait for diagnostics to settle.
      // Files of a type with no language server resolve immediately (no server).
      await Promise.all(filePaths.map((fp) => touchAndWait(fp, projectRoot).catch(() => {})))
      return buildInlineDiagnostics(
        filePaths,
        collectDiagnostics(projectRoot, { forReport: true }),
        projectRoot,
      )
    },

    getDiagnostics(projectRoot) {
      return collectDiagnostics(projectRoot)
    },

    getFileDiagnostics(projectRoot, filePath) {
      return collectDiagnostics(projectRoot)[filePath] ?? []
    },

    openDocument(projectRoot, filePath, content) {
      return syncDocument(filePath, projectRoot, content)
    },

    changeDocument(projectRoot, filePath, content) {
      return syncDocument(filePath, projectRoot, content)
    },

    saveDocument,
    closeDocument,

    ...createLspManagerQueries(withReadyClient, collectDiagnostics),

    workspaceSymbols,

    notifyWatchedFiles: (projectRoot, changes) =>
      notifyWatchedFiles(byProject.get(projectRoot)?.values(), changes),

    getServerStates(projectRoot) {
      return computeStates(projectRoot)
    },

    onUpdate(handler) {
      updateHandlers.add(handler)
      return () => updateHandlers.delete(handler)
    },

    setPluginServers(projectRoot, defs) {
      if (defs.length === 0) pluginServers.delete(projectRoot)
      else pluginServers.set(projectRoot, defs)
    },

    dispose() {
      disposed = true
      for (const process of startingProcesses.values())
        killProcessTree(process.pid, undefined, stillRunning(process))
      startingProcesses.clear()
      for (const clients of byProject.values()) {
        for (const mc of clients.values()) {
          clearIdleTimer(mc)
          try {
            mc.client?.dispose()
          } catch {
            /* ignore */
          }
        }
      }
      byProject.clear()
      startingMap.clear()
      pluginServers.clear()
      updateHandlers.clear()
    },
  }
}
