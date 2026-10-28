import type { LspClientInfo, LspDiagnostic, LspWorkspaceSymbol } from './lsp-client'
import type { LspManager, LspServerStatus } from './lsp-manager-types'

interface ProjectClient {
  client: Pick<
    LspClientInfo,
    'saveDocument' | 'closeDocument' | 'diagnostics' | 'workspaceSymbols'
  > | null
  serverId: string
  rootDir: string
  status: LspServerStatus
  diagnostics: Record<string, LspDiagnostic[]>
  pending?: Map<string, unknown>
}

interface ProjectOperationPorts<T extends ProjectClient> {
  getClients: (projectRoot: string) => ReadonlyMap<string, T> | undefined
  clearIdleTimer: (client: T) => void
  armIdleEviction: (projectRoot: string, key: string, client: T) => void
  notifyUpdate: (projectRoot: string) => void
}

/** Operations across existing project clients; server startup stays with the manager. */
export function createProjectOperations<T extends ProjectClient>({
  getClients,
  clearIdleTimer,
  armIdleEviction,
  notifyUpdate,
}: ProjectOperationPorts<T>): Pick<
  LspManager,
  'saveDocument' | 'closeDocument' | 'workspaceSymbols'
> {
  return {
    async saveDocument(projectRoot, filePath) {
      const clients = getClients(projectRoot)
      if (!clients) return
      await Promise.all(
        Array.from(clients.values(), async (mc) => {
          await mc.client?.saveDocument(filePath).catch(() => {})
        }),
      )
    },

    async closeDocument(projectRoot, filePath) {
      const clients = getClients(projectRoot)
      if (!clients) return
      await Promise.all(
        Array.from(clients.entries(), async ([key, mc]) => {
          // A buffer closed while its server installs is not opened once it is ready.
          mc.pending?.delete(filePath)
          if (!mc.client) return
          await mc.client.closeDocument(filePath).catch(() => {})
          mc.diagnostics = mc.client.diagnostics()
          armIdleEviction(projectRoot, key, mc)
        }),
      )
      notifyUpdate(projectRoot)
    },

    // Project-scoped searches use every ready client without starting a server.
    async workspaceSymbols(projectRoot, query) {
      const clients = getClients(projectRoot)
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
  }
}
