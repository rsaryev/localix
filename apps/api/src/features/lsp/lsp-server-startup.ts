import type { createLspClient } from './lsp-client'
import type { ManagedClient } from './lsp-managed-client'
import type { LspServerDef } from './lsp-servers'
import type { LspHealthObserver } from '../notifications/conditions/lsp'
import { killProcessTree, stillRunning } from '../agent-core/tools/bash/process-tree'

interface ServerStartupPorts {
  createClient: typeof createLspClient
  startingProcesses: Map<string, { pid?: number; exitCode?: number | null }>
  isDisposed(): boolean
  getHealth(): LspHealthObserver | undefined
  candidateServers(filePath: string, projectRoot: string): LspServerDef[]
  projectClients(projectRoot: string): Map<string, ManagedClient>
  projectStarting(projectRoot: string): Map<string, Promise<void>>
  clearIdleTimer(client: ManagedClient): void
  armIdleEviction(projectRoot: string, key: string, client: ManagedClient): void
  notifyUpdate(projectRoot: string): void
}

const SERVER_DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
}

/** Coordinate one startup per project/server root and clean up every settled attempt. */
export function createServerStartup({
  createClient,
  startingProcesses,
  isDisposed,
  getHealth,
  candidateServers,
  projectClients,
  projectStarting,
  clearIdleTimer,
  armIdleEviction,
  notifyUpdate,
}: ServerStartupPorts) {
  async function ensureServer(
    filePath: string,
    projectRoot: string,
  ): Promise<ManagedClient | null> {
    if (isDisposed()) return null
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
      ...(serverDef.reportsDiagnostics === false ? { reportsDiagnostics: false as const } : {}),
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
        if (isDisposed()) {
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
          ...(handle.settings ? { settings: handle.settings } : {}),
          ...(handle.initializeTimeoutMs
            ? { initializeTimeoutMs: handle.initializeTimeoutMs }
            : {}),
          ...(handle.requestTimeoutMs ? { requestTimeoutMs: handle.requestTimeoutMs } : {}),
          ...(handle.shutdownTimeoutMs ? { shutdownTimeoutMs: handle.shutdownTimeoutMs } : {}),
          ...(handle.languageIdFor ? { languageIdFor: handle.languageIdFor } : {}),
          onDiagnosticsUpdate(byFile) {
            mc.diagnostics = byFile
            notifyUpdate(projectRoot)
          },
          onReady() {
            mc.status = 'ready'
            notifyUpdate(projectRoot)
            getHealth()?.ready(mc)
          },
          onError() {
            mc.status = 'error'
            getHealth()?.failed(mc, 'crash')
            // Release the process, connection and diagnostic timers before removing the client.
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
          getHealth()?.failed(mc, 'start')
          clients.delete(key)
          notifyUpdate(projectRoot)
          return
        }
        if (isDisposed()) {
          client.dispose()
          clients.delete(key)
          return
        }
        mc.client = client
        startingProcesses.delete(`${projectRoot}\0${key}`)
        armIdleEviction(projectRoot, key, mc)
      } catch {
        // Initialization can fail after spawn; release that process as well.
        const spawned = handle?.process
        killProcessTree(spawned?.pid, undefined, stillRunning(spawned))
        mc.status = 'error'
        if (!isDisposed()) getHealth()?.failed(mc, 'start')
        clients.delete(key)
        notifyUpdate(projectRoot)
      } finally {
        startingProcesses.delete(`${projectRoot}\0${key}`)
        // A failed attempt must not prevent a later startup.
        starting.delete(key)
      }
    })()

    starting.set(key, startPromise)
    await startPromise
    return clients.get(key) ?? null
  }

  return ensureServer
}
