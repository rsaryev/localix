import type { LspClientInfo, LspDiagnostic } from './lsp-client'
import type { LspServerStatus } from './lsp-manager-types'

export interface ManagedClient {
  client: LspClientInfo | null
  serverId: string
  serverName: string
  rootDir: string
  status: LspServerStatus
  diagnostics: Record<string, LspDiagnostic[]>
  /** `false`: kept out of the report after an edit (its server's `diagnostics: false`). */
  reportsDiagnostics?: false
  idleTimer?: ReturnType<typeof setTimeout>
}
