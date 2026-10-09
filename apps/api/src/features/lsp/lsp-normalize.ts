// Public response-normalization surface; feature groups share the same wire-value conversions.
export {
  normalizeRelatedInformation,
  normalizeDiagnostic,
  diagnosticsOverlappingRange,
} from './lsp-normalize-diagnostics'
export {
  normalizeTextEdits,
  normalizeWorkspaceEdit,
  normalizeCodeAction,
  normalizeCodeActions,
  normalizePrepareRename,
} from './lsp-normalize-edits'
export {
  normalizeLocations,
  normalizeCallHierarchyItems,
  normalizeIncomingCallSites,
  normalizeOutgoingCallSites,
  normalizeDocumentSymbols,
  normalizeWorkspaceSymbols,
} from './lsp-normalize-navigation'
export {
  normalizeDocumentHighlights,
  normalizeInlayHints,
  normalizeDocumentColors,
  markupToText,
  normalizeCompletionItems,
  normalizeSignatureHelp,
} from './lsp-normalize-presentation'
