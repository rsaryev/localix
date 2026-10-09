import type { MessageConnection } from 'vscode-jsonrpc/node'
import type { CapabilityRegistration, DiagnosticRequestResult } from './lsp-client-contract'
import {
  requestDocumentDiagnosticReport,
  requestWorkspaceDiagnosticReport,
} from './lsp-diagnostics-pull'

interface DiagnosticPullPorts {
  connection: MessageConnection
  diagnosticRegistrations: ReadonlyMap<string, CapabilityRegistration>
  hasStaticPullDiagnostics(): boolean
  getWorkspacePullInFlight(): Map<string, Promise<DiagnosticRequestResult>>
  mergePullResults(
    filePath: string,
    results: DiagnosticRequestResult[],
  ): { handled: boolean; matched: boolean }
}

/** Select live registrations and share workspace requests only until they settle. */
export function createDiagnosticPullCoordinator({
  connection,
  diagnosticRegistrations,
  hasStaticPullDiagnostics,
  getWorkspacePullInFlight,
  mergePullResults,
}: DiagnosticPullPorts) {
  function pullRegistrations(workspaceDiagnostics: boolean) {
    return [...diagnosticRegistrations.values()].filter(
      (registration) => registration.registerOptions?.workspaceDiagnostics === workspaceDiagnostics,
    )
  }

  // Concurrent document pulls share each workspace identifier; later pulls request fresh data.
  function sharedWorkspaceReport(identifier?: string): Promise<DiagnosticRequestResult> {
    const key = identifier ?? ''
    const existing = getWorkspacePullInFlight().get(key)
    if (existing) return existing
    const pending = requestWorkspaceDiagnosticReport(connection, identifier).finally(() => {
      getWorkspacePullInFlight().delete(key)
    })
    getWorkspacePullInFlight().set(key, pending)
    return pending
  }

  async function requestDiagnostics(filePath: string) {
    const documentRegistrations = pullRegistrations(false)
    const workspaceRegistrations = pullRegistrations(true)
    const documentIdentifiers = [
      ...new Set(documentRegistrations.flatMap((r) => r.registerOptions?.identifier ?? [])),
    ]
    const workspaceIdentifiers = [
      ...new Set(workspaceRegistrations.flatMap((r) => r.registerOptions?.identifier ?? [])),
    ]

    const requests: Promise<DiagnosticRequestResult>[] = []
    if (hasStaticPullDiagnostics() || documentRegistrations.length > 0) {
      requests.push(requestDocumentDiagnosticReport(connection, filePath))
      requests.push(
        ...documentIdentifiers.map((identifier) =>
          requestDocumentDiagnosticReport(connection, filePath, identifier),
        ),
      )
    }
    if (workspaceRegistrations.length > 0) {
      requests.push(sharedWorkspaceReport())
      requests.push(...workspaceIdentifiers.map((identifier) => sharedWorkspaceReport(identifier)))
    }
    if (!requests.length) return { handled: false, matched: false }
    return mergePullResults(filePath, await Promise.all(requests))
  }

  return requestDiagnostics
}
