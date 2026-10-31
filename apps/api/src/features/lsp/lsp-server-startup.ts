import type { createLspClient } from './lsp-client'
import type { ManagedClient } from './lsp-managed-client'
import type { LspInstaller } from './lsp-installer'
import type { LspServerUnavailable } from './lsp-manager-types'
import { INSTALL_RETRY_AFTER_MS, SERVER_DISPLAY_NAMES } from './lsp-startup-policy'
import type { LspServerDef } from './lsp-servers'
import type { LspHealthObserver } from '../notifications/conditions/lsp'
import { killProcessTree, stillRunning } from '../../lib/process-tree'

export { INSTALL_RETRY_AFTER_MS } from './lsp-startup-policy'

interface ServerStartupPorts {
  createClient: typeof createLspClient
  startingProcesses: Map<string, { pid?: number; exitCode?: number | null }>
  isDisposed: () => boolean
  getHealth: () => LspHealthObserver | undefined
  candidateServers: (filePath: string, projectRoot: string) => LspServerDef[]
  projectClients: (projectRoot: string) => Map<string, ManagedClient>
  projectStarting: (projectRoot: string) => Map<string, Promise<void>>
  clearIdleTimer: (client: ManagedClient) => void
  armIdleEviction: (projectRoot: string, key: string, client: ManagedClient) => void
  notifyUpdate: (projectRoot: string) => void
  /** Fetches a server nothing local provides; absent, such a server is simply not started. */
  installer?: LspInstaller
  now: () => number
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
  installer,
  now,
}: ServerStartupPorts) {
  /**
   * Spawn the server and initialize its client. `missing`: nothing serves the file, the client
   * entry is left for the caller to settle (drop it, or install the server).
   */
  async function launch(
    mc: ManagedClient,
    serverDef: LspServerDef,
    projectRoot: string,
    key: string,
    installed: string | undefined,
  ): Promise<'started' | 'missing' | 'failed'> {
    const { rootDir } = mc
    const clients = projectClients(projectRoot)
    let handle
    try {
      handle = await serverDef.spawn(rootDir, projectRoot, installed)
      if (handle) startingProcesses.set(`${projectRoot}\0${key}`, handle.process)
    } catch {
      /* not installed */
    }
    try {
      if (isDisposed()) {
        const spawned = handle?.process
        killProcessTree(spawned?.pid, undefined, stillRunning(spawned))
        clients.delete(key)
        return 'failed'
      }
      if (!handle) return 'missing'
      mc.status = 'starting'
      notifyUpdate(projectRoot)
      const client = await createClient({
        serverId: serverDef.id,
        process: handle.process,
        rootDir,
        initialization: handle.initialization,
        ...(handle.settings ? { settings: handle.settings } : {}),
        ...(handle.initializeTimeoutMs ? { initializeTimeoutMs: handle.initializeTimeoutMs } : {}),
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
        return 'failed'
      }
      if (isDisposed()) {
        client.dispose()
        clients.delete(key)
        return 'failed'
      }
      mc.client = client
      startingProcesses.delete(`${projectRoot}\0${key}`)
      armIdleEviction(projectRoot, key, mc)
      return 'started'
    } catch {
      // Initialization can fail after spawn; release that process as well.
      const spawned = handle?.process
      killProcessTree(spawned?.pid, undefined, stillRunning(spawned))
      mc.status = 'error'
      if (!isDisposed()) getHealth()?.failed(mc, 'start')
      clients.delete(key)
      notifyUpdate(projectRoot)
      return 'failed'
    } finally {
      startingProcesses.delete(`${projectRoot}\0${key}`)
    }
  }

  function markUnavailable(mc: ManagedClient, projectRoot: string, why: LspServerUnavailable) {
    mc.status = 'unavailable'
    mc.unavailable = why
    mc.retryAt = now() + INSTALL_RETRY_AFTER_MS[why.reason]
    delete mc.pending
    notifyUpdate(projectRoot)
  }

  /**
   * Fetch the server in the background, then start it and open the buffers the editor sent
   * meanwhile. Requests made while it installs answer at once with nothing (the client entry is
   * not `ready`), so a download never holds up hover or completion.
   */
  function installThenLaunch(
    mc: ManagedClient,
    serverDef: LspServerDef,
    projectRoot: string,
    key: string,
    recipeId: string,
  ) {
    const clients = projectClients(projectRoot)
    const starting = projectStarting(projectRoot)
    mc.status = 'installing'
    notifyUpdate(projectRoot)
    void installer!
      .install(recipeId, (fraction) => {
        if (clients.get(key) !== mc) return
        mc.progress = fraction
        notifyUpdate(projectRoot)
      })
      .then(async (outcome) => {
        if (isDisposed() || clients.get(key) !== mc) return
        delete mc.progress
        if (!outcome.ok) {
          markUnavailable(mc, projectRoot, { reason: outcome.reason, detail: outcome.detail })
          return
        }
        const started = launch(mc, serverDef, projectRoot, key, outcome.dir)
        starting.set(
          key,
          started.then(
            () => {},
            () => {},
          ),
        )
        let result: Awaited<typeof started>
        try {
          result = await started
        } finally {
          starting.delete(key)
        }
        if (result === 'missing') {
          markUnavailable(mc, projectRoot, {
            reason: 'failed',
            detail: `${mc.serverName} was installed but did not start`,
          })
          return
        }
        const pending = mc.pending
        delete mc.pending
        if (result !== 'started' || !mc.client || !pending?.size) return
        for (const push of pending.values()) await push(mc.client).catch(() => {})
        mc.diagnostics = mc.client.diagnostics()
        notifyUpdate(projectRoot)
      })
      .catch((err: unknown) => {
        // Nothing awaits this chain: a throwing status listener or a failed hand-off must not
        // become an unhandled rejection, nor leave the entry reported as installing.
        if (isDisposed() || clients.get(key) !== mc) return
        if (mc.status !== 'installing' && mc.status !== 'starting') return
        delete mc.progress
        try {
          markUnavailable(mc, projectRoot, {
            reason: 'failed',
            detail: err instanceof Error ? err.message : String(err),
          })
        } catch {
          /* the state is set before the listeners hear of it; the one that threw is not asked again */
        }
      })
  }

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

    // Already running, installing, or reported unavailable until its retry time
    if (clients.has(key) && !starting.has(key)) {
      const existing = clients.get(key)!
      if (existing.status !== 'unavailable' || now() < (existing.retryAt ?? 0)) {
        clearIdleTimer(existing)
        return existing
      }
      clients.delete(key)
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

    const recipeId = installer ? serverDef.install : undefined
    const startPromise = (async () => {
      try {
        const installed = recipeId ? installer!.installedDir(recipeId) : undefined
        if ((await launch(mc, serverDef, projectRoot, key, installed)) !== 'missing') return
        if (recipeId && !installed && !isDisposed()) {
          installThenLaunch(mc, serverDef, projectRoot, key, recipeId)
          return
        }
        clients.delete(key)
        notifyUpdate(projectRoot)
      } finally {
        // A failed attempt must not prevent a later startup.
        starting.delete(key)
      }
    })()

    starting.set(key, startPromise)
    await startPromise
    // An install that finished meanwhile is launching now: wait for it like any startup, so the
    // caller's buffer reaches the server instead of falling between "installing" and "ready".
    while (starting.has(key)) await starting.get(key)
    return clients.get(key) ?? null
  }

  return ensureServer
}
