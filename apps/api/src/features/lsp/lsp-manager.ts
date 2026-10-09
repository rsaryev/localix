import {
  createLspClient,
  type LspClientInfo,
  type LspDiagnostic,
  type LspWorkspaceSymbol,
} from './lsp-client'
import { getServersForFile, type LspServerDef } from './lsp-servers'
import { createLspManagerQueries } from './lsp-manager-queries'
import { createDiagnosticsWait, SILENT_COOLDOWN_MS } from './lsp-diagnostics-wait'
import { matchingLspServers } from './lsp-server-match'
import { buildInlineDiagnostics } from './diagnostics-report'
import { notifyWatchedFiles } from './lsp-watched-files'
import { killProcessTree, stillRunning } from '../agent-core/tools/bash/process-tree'
import type { LspManager, LspServerState, LspServerStatus } from './lsp-manager-types'
import type { LspHealthObserver } from '../notifications/conditions/lsp'

// Manager interface + server-state types live in ./lsp-manager-types; re-exported
// here so the historical `./lsp-manager` import surface stays unchanged.
export type { LspManager, LspServerState, LspServerStatus } from './lsp-manager-types'

interface ManagedClient {
  client: LspClientInfo | null
  serverId: string
  serverName: string
  rootDir: string
  status: LspServerStatus
  diagnostics: Record<string, LspDiagnostic[]>
  idleTimer?: ReturnType<typeof setTimeout>
}

export const LSP_IDLE_TIMEOUT_MS = 5 * 60_000
export { SILENT_STRIKES, SILENT_COOLDOWN_MS } from './lsp-diagnostics-wait'
interface LspManagerOptions {
  idleTimeoutMs?: number
  /** Test seam for the silent-project cooldown; production keeps SILENT_COOLDOWN_MS. */
  silentCooldownMs?: number
  createClient?: typeof createLspClient
  /** A server that crashed or failed to start, as a standing Event Center row until it is ready. */
  health?: LspHealthObserver
}

const SERVER_DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
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

  function clearIdleTimer(mc: ManagedClient): void {
    if (mc.idleTimer) clearTimeout(mc.idleTimer)
    mc.idleTimer = undefined
  }

  function disposeManaged(projectRoot: string, key: string, mc: ManagedClient): void {
    clearIdleTimer(mc)
    try {
      mc.client?.dispose()
    } catch {
      /* idempotent */
    }
    const clients = byProject.get(projectRoot)
    if (clients?.get(key) === mc) clients.delete(key)
    if (clients?.size === 0) byProject.delete(projectRoot)
    notifyUpdate(projectRoot)
  }

  function armIdleEviction(projectRoot: string, key: string, mc: ManagedClient): void {
    clearIdleTimer(mc)
    if (disposed || idleTimeoutMs <= 0 || !mc.client || mc.client.hasOpenDocuments()) return
    mc.idleTimer = setTimeout(() => {
      if (!mc.client?.hasOpenDocuments() && !startingMap.get(projectRoot)?.has(key))
        disposeManaged(projectRoot, key, mc)
    }, idleTimeoutMs)
    mc.idleTimer.unref?.()
  }

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

  function computeStates(projectRoot: string): LspServerState[] {
    const clients = byProject.get(projectRoot)
    if (!clients) return []
    return Array.from(clients.values()).map((mc) => {
      let errorCount = 0
      let warningCount = 0
      for (const diags of Object.values(mc.diagnostics)) {
        for (const d of diags) {
          if (d.severity === 1) errorCount++
          else if (d.severity === 2) warningCount++
        }
      }
      return {
        serverId: mc.serverId,
        serverName: mc.serverName,
        rootDir: mc.rootDir,
        status: mc.status,
        errorCount,
        warningCount,
      }
    })
  }

  function notifyUpdate(projectRoot: string) {
    const states = computeStates(projectRoot)
    for (const h of updateHandlers) h(projectRoot, states)
  }

  async function ensureServer(
    filePath: string,
    projectRoot: string,
  ): Promise<ManagedClient | null> {
    if (disposed) return null
    let match: { serverDef: LspServerDef; rootDir: string } | undefined
    for (const serverDef of candidateServers(filePath, projectRoot)) {
      const rootDir = serverDef.resolveRoot(filePath, projectRoot)
      if (!rootDir) continue
      match = { serverDef, rootDir }
      break
    }
    if (!match) return null

    const { serverDef, rootDir } = match
    const key = `${serverDef.id}:${rootDir}`
    const clients = projectClients(projectRoot)
    const starting = projectStarting(projectRoot)

    // Already running
    if (clients.has(key) && !starting.has(key)) {
      const existing = clients.get(key)!
      clearIdleTimer(existing)
      return existing
    }

    // Already starting — wait for it
    if (starting.has(key)) {
      await starting.get(key)
      return clients.get(key) ?? null
    }

    // Start it
    const mc: ManagedClient = {
      client: null,
      serverId: serverDef.id,
      serverName: SERVER_DISPLAY_NAMES[serverDef.id] ?? serverDef.id,
      rootDir,
      status: 'starting',
      diagnostics: {},
    }
    clients.set(key, mc)
    notifyUpdate(projectRoot)

    const startPromise = (async () => {
      let handle
      try {
        handle = await serverDef.spawn(rootDir, projectRoot)
        if (handle) startingProcesses.set(`${projectRoot}\0${key}`, handle.process)
      } catch {
        /* not installed */
      }
      try {
        if (disposed) {
          const spawned = handle?.process
          killProcessTree(spawned?.pid, undefined, stillRunning(spawned))
          clients.delete(key)
          return
        }
        if (!handle) {
          clients.delete(key)
          notifyUpdate(projectRoot)
          return
        }
        const client = await createClient({
          serverId: serverDef.id,
          process: handle.process,
          rootDir,
          initialization: handle.initialization,
          onDiagnosticsUpdate(byFile) {
            mc.diagnostics = byFile
            notifyUpdate(projectRoot)
          },
          onReady() {
            mc.status = 'ready'
            notifyUpdate(projectRoot)
            options.health?.ready(mc)
          },
          onError() {
            mc.status = 'error'
            options.health?.failed(mc, 'crash')
            // Dispose the crashed client — kills the process, the JSON-RPC
            // connection, and the diagnostics debounce timer. Deleting the map
            // entry alone left a zombie process + leaked timer on a server crash.
            try {
              mc.client?.dispose()
            } catch {
              /* idempotent */
            }
            clearIdleTimer(mc)
            clients.delete(key)
            notifyUpdate(projectRoot)
          },
        })
        if (!client) {
          mc.status = 'error'
          options.health?.failed(mc, 'start')
          clients.delete(key)
          notifyUpdate(projectRoot)
          return
        }
        if (disposed) {
          client.dispose()
          clients.delete(key)
          return
        }
        mc.client = client
        startingProcesses.delete(`${projectRoot}\0${key}`)
        armIdleEviction(projectRoot, key, mc)
      } catch {
        // createLspClient threw AFTER spawn (e.g. a post-init notification on an
        // already-closed stream). Without this the spawned process leaks AND the
        // `starting` promise stays permanently rejected, so every future
        // ensureServer for this root throws forever (`await starting.get(key)`).
        const spawned = handle?.process
        killProcessTree(spawned?.pid, undefined, stillRunning(spawned))
        mc.status = 'error'
        if (!disposed) options.health?.failed(mc, 'start')
        clients.delete(key)
        notifyUpdate(projectRoot)
      } finally {
        startingProcesses.delete(`${projectRoot}\0${key}`)
        // ALWAYS clear so the key is never wedged on a permanently-rejected promise.
        starting.delete(key)
      }
    })()

    starting.set(key, startPromise)
    await startPromise
    return clients.get(key) ?? null
  }

  // Write-path twin of withReadyClient: start the server if needed, run a
  // document-push call once it's ready, then refresh cached diagnostics + notify.
  // The touch (disk) and sync (editor buffer) paths differ only in the client call.
  async function pushDocument<T>(
    filePath: string,
    projectRoot: string,
    push: (client: NonNullable<ManagedClient['client']>) => Promise<T>,
  ): Promise<T | undefined> {
    const mc = await ensureServer(filePath, projectRoot)
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

  function collectDiagnostics(projectRoot: string): Record<string, LspDiagnostic[]> {
    const clients = byProject.get(projectRoot)
    if (!clients) return {}
    const merged: Record<string, LspDiagnostic[]> = {}
    for (const mc of clients.values()) {
      for (const [file, diags] of Object.entries(mc.diagnostics)) {
        if (!merged[file]) merged[file] = []
        merged[file].push(...diags)
      }
    }
    return merged
  }

  return {
    async reportFileDiagnostics(filePaths, projectRoot) {
      // Touch every changed file in parallel and wait for diagnostics to settle.
      // Files of a type with no language server resolve immediately (no server).
      await Promise.all(filePaths.map((fp) => touchAndWait(fp, projectRoot).catch(() => {})))
      return buildInlineDiagnostics(filePaths, collectDiagnostics(projectRoot), projectRoot)
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

    async saveDocument(projectRoot, filePath) {
      const clients = byProject.get(projectRoot)
      if (!clients) return
      await Promise.all(
        Array.from(clients.values(), async (mc) => {
          await mc.client?.saveDocument(filePath).catch(() => {})
        }),
      )
    },

    async closeDocument(projectRoot, filePath) {
      const clients = byProject.get(projectRoot)
      if (!clients) return
      await Promise.all(
        Array.from(clients.entries(), async ([key, mc]) => {
          if (!mc.client) return
          await mc.client.closeDocument(filePath).catch(() => {})
          mc.diagnostics = mc.client.diagnostics()
          armIdleEviction(projectRoot, key, mc)
        }),
      )
      notifyUpdate(projectRoot)
    },

    ...createLspManagerQueries(withReadyClient, collectDiagnostics),

    // workspace/symbol is project-scoped (no file), so it can't go through
    // withReadyClient (which needs a file to pick/start a server). Instead query
    // EVERY already-running server for the root and merge, so only the language servers
    // currently alive are searched.
    async workspaceSymbols(projectRoot, query) {
      const clients = byProject.get(projectRoot)
      if (!clients) return []
      const ready = [...clients.values()].filter((mc) => mc.client && mc.status === 'ready')
      const batches = await Promise.all(
        ready.map(async (mc) => {
          const key = `${mc.serverId}:${mc.rootDir}`
          clearIdleTimer(mc)
          try {
            return await mc.client!.workspaceSymbols(query).catch(() => [] as LspWorkspaceSymbol[])
          } finally {
            armIdleEviction(projectRoot, key, mc)
          }
        }),
      )
      return batches.flat()
    },

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
