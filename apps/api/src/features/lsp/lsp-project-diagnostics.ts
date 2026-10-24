import type { LspDiagnostic } from './lsp-client'
import type { LspServerState } from './lsp-manager-types'

interface DiagnosticClientState extends Pick<
  LspServerState,
  'serverId' | 'serverName' | 'rootDir' | 'status'
> {
  diagnostics: Record<string, LspDiagnostic[]>
  reportsDiagnostics?: false
}

/** Read current client snapshots in insertion order without owning their lifecycle. */
export function createProjectDiagnostics(
  getClients: (projectRoot: string) => ReadonlyMap<string, DiagnosticClientState> | undefined,
) {
  function computeStates(projectRoot: string): LspServerState[] {
    const clients = getClients(projectRoot)
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

  /** Every client's diagnostics by file; `forReport` leaves out a server that reports none. */
  function collectDiagnostics(
    projectRoot: string,
    opts: { forReport?: boolean } = {},
  ): Record<string, LspDiagnostic[]> {
    const clients = getClients(projectRoot)
    if (!clients) return {}
    const merged: Record<string, LspDiagnostic[]> = {}
    for (const mc of clients.values()) {
      if (opts.forReport && mc.reportsDiagnostics === false) continue
      for (const [file, diags] of Object.entries(mc.diagnostics)) {
        if (!merged[file]) merged[file] = []
        merged[file].push(...diags)
      }
    }
    return merged
  }

  return { computeStates, collectDiagnostics }
}
