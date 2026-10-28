import type { LspClientInfo, LspDiagnostic } from './lsp-client'
import type { LspServerStatus, LspServerUnavailable } from './lsp-manager-types'

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
  /** While `installing`: the install's progress, 0–1, when known. */
  progress?: number
  /** While `unavailable`: why, and when the next request may try again. */
  unavailable?: LspServerUnavailable
  retryAt?: number
  /** Buffers the editor opened or changed while the server was installing, by file, latest wins. */
  pending?: Map<string, (client: LspClientInfo) => Promise<unknown>>
}
