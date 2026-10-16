import type { MessageConnection } from 'vscode-jsonrpc/node'
import { withTimeout } from '../../lib/timeout'
import {
  DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  fileUri,
  fromFileUri,
  type DiagnosticRequestResult,
  type DocumentDiagnosticReport,
  type LspDiagnostic,
  type WorkspaceDiagnosticReport,
} from './lsp-protocol'

/**
 * Pull-model diagnostics requests (`textDocument/diagnostic` +
 * `workspace/diagnostic`). Pure given the JSON-RPC connection: each builds a
 * request, applies the standard timeout, and normalizes the report into a
 * `{ handled, matched, byFile }` result. Extracted out of the `createLspClient`
 * closure (it touches no client-side mutable state) so the client file stays
 * focused on connection lifecycle + document sync.
 */

/** Request a single document's pull diagnostics (plus any related-document reports). */
export async function requestDocumentDiagnosticReport(
  connection: MessageConnection,
  filePath: string,
  identifier?: string,
): Promise<DiagnosticRequestResult> {
  const report = await withTimeout(
    connection.sendRequest<DocumentDiagnosticReport | null>('textDocument/diagnostic', {
      ...(identifier ? { identifier } : {}),
      textDocument: { uri: fileUri(filePath) },
    }),
    DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  ).catch(() => null)
  if (!report) return { handled: false, matched: false, byFile: new Map() }

  const byFile = new Map<string, LspDiagnostic[]>()
  if (Array.isArray(report.items)) byFile.set(filePath, report.items)
  for (const [uri, related] of Object.entries(report.relatedDocuments ?? {})) {
    const relatedPath = fromFileUri(uri)
    if (!relatedPath || !Array.isArray(related.items)) continue
    byFile.set(relatedPath, [...(byFile.get(relatedPath) ?? []), ...related.items])
  }

  return { handled: byFile.size > 0, matched: byFile.has(filePath), byFile }
}

/** Request whole-workspace pull diagnostics (no single file is the focus). */
export async function requestWorkspaceDiagnosticReport(
  connection: MessageConnection,
  identifier?: string,
): Promise<DiagnosticRequestResult> {
  const report = await withTimeout(
    connection.sendRequest<WorkspaceDiagnosticReport | null>('workspace/diagnostic', {
      ...(identifier ? { identifier } : {}),
      previousResultIds: [],
    }),
    DIAGNOSTICS_REQUEST_TIMEOUT_MS,
  ).catch(() => null)
  if (!report) return { handled: false, matched: false, byFile: new Map() }

  const byFile = new Map<string, LspDiagnostic[]>()
  for (const item of report.items ?? []) {
    const filePath = item.uri ? fromFileUri(item.uri) : undefined
    if (!filePath || !Array.isArray(item.items)) continue
    byFile.set(filePath, [...(byFile.get(filePath) ?? []), ...item.items])
  }

  return { handled: true, matched: false, byFile }
}
