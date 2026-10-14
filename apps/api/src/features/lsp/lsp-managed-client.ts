import type { LspClientInfo, LspDiagnostic } from './lsp-client'
import type { LspServerStatus } from './lsp-manager-types'

export interface ManagedClient {
  client: LspClientInfo | null
  serverId: string
  serverName: string
  rootDir: string
  status: LspServerStatus
  diagnostics: Record<string, LspDiagnostic[]>
  idleTimer?: ReturnType<typeof setTimeout>
}
