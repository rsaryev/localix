import { pathToFileURL, fileURLToPath } from 'node:url'
import type { LspDiagnostic } from './lsp-response-types'
import type { ServerCapabilities } from './lsp-client-contract'

// Pure LSP response normalizers live in lsp-normalize.ts; re-exported here so the
// historical `./lsp-protocol` import surface stays stable for lsp-client + tests.
export {
  normalizeLocations,
  normalizeCallHierarchyItems,
  normalizeIncomingCallSites,
  normalizeOutgoingCallSites,
  normalizeDocumentHighlights,
  normalizeInlayHints,
  normalizeDocumentColors,
  markupToText,
  normalizeCompletionItems,
  normalizeSignatureHelp,
  normalizeDocumentSymbols,
  normalizeWorkspaceSymbols,
  normalizeWorkspaceEdit,
  normalizePrepareRename,
  normalizeTextEdits,
  normalizeCodeActions,
  normalizeDiagnostic,
} from './lsp-normalize'

export type {
  LspRelatedInformation,
  LspDiagnostic,
  LspPosition,
  LspRange,
  LspHoverInfo,
  LspSignatureHelp,
  LspDocumentSymbol,
  LspWorkspaceSymbol,
  LspCompletionItem,
  LspLocation,
  LspCallHierarchyItem,
  LspDocumentHighlight,
  LspInlayHint,
  LspColorInfo,
  LspTextEdit,
  CodeActionTrigger,
  LspFormattingOptions,
  LspWorkspaceEditFile,
  LspCodeActionCommand,
  LspCodeAction,
  LspPrepareRename,
} from './lsp-response-types'
export type {
  LspClientInfo,
  ServerCapabilities,
  CapabilityRegistration,
  DocumentDiagnosticReport,
  WorkspaceDiagnosticReport,
  DiagnosticRequestResult,
} from './lsp-client-contract'

export const INITIALIZE_TIMEOUT_MS = 30_000
export const DIAGNOSTICS_WAIT_TIMEOUT_MS = 6_000
export const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000
/**
 * At most one diagnostics publish per this interval, the FIRST of a burst immediately.
 * It was a 150 ms trailing debounce that restarted on every push, so the squiggle for a
 * syntax error waited out the semantic and suggestion passes that followed it.
 */
export const DIAGNOSTICS_PUBLISH_INTERVAL_MS = 100

// LSP spec constants
export const FILE_CHANGE_CREATED = 1
export const FILE_CHANGE_CHANGED = 2
export const TEXT_DOCUMENT_SYNC_INCREMENTAL = 2
/** LSP `CodeActionTriggerKind`. */
export const CODE_ACTION_TRIGGER_INVOKED = 1
export const CODE_ACTION_TRIGGER_AUTOMATIC = 2

export function getSyncKind(caps?: ServerCapabilities): number | undefined {
  if (!caps) return undefined
  const sync = caps.textDocumentSync
  if (typeof sync === 'number') return sync
  return sync?.change
}

/**
 * Whether the server asked to receive the document BODY with `didSave`.
 *
 * The spec makes `DidSaveTextDocumentParams.text` conditional — "Depends on the
 * includeText value when the save notification was requested" — so a server that
 * did not declare `save.includeText` is entitled to discard it. Sending it anyway
 * put the whole buffer on the wire a second time on every editor sync, on top of
 * the copy `didChange` already carried.
 */
export function saveIncludesText(caps?: ServerCapabilities): boolean {
  const sync = caps?.textDocumentSync
  if (!sync || typeof sync === 'number') return false
  return typeof sync.save === 'object' && sync.save?.includeText === true
}

export function fileUri(p: string): string {
  return pathToFileURL(p).href
}

export function fromFileUri(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined
  try {
    return fileURLToPath(uri)
  } catch {
    return undefined
  }
}

export function configurationValue(settings: unknown, section?: string) {
  if (!section) return settings ?? null
  const result = section.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object' || !(key in acc)) return undefined
    return (acc as Record<string, unknown>)[key]
  }, settings)
  return result ?? null
}

export function dedupeDiagnostics(items: LspDiagnostic[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = JSON.stringify({
      code: item.code,
      severity: item.severity,
      message: item.message,
      source: item.source,
      range: item.range,
    })
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
