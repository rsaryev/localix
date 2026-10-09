import type { LspWatchedFileChange } from './lsp-watched-files'
import type {
  LspDiagnostic,
  LspPosition,
  LspRange,
  LspHoverInfo,
  LspSignatureHelp,
  LspDocumentSymbol,
  LspWorkspaceSymbol,
  LspCompletionItem,
  LspLocation,
  LspDocumentHighlight,
  LspInlayHint,
  LspColorInfo,
  LspTextEdit,
  CodeActionTrigger,
  LspFormattingOptions,
  LspWorkspaceEditFile,
  LspCodeAction,
  LspPrepareRename,
} from './lsp-response-types'

export interface LspClientInfo {
  serverId: string
  rootUri: string
  /**
   * Notify LSP about a file (read from disk) and, unless `wait` is false, WAIT for diagnostics
   * (up to 6s). Resolves true when the server answered (push or pull), false when the wait
   * ran out — the signal the manager uses to stop paying for a server that never answers.
   */
  touchFileAndWait(filePath: string, wait?: boolean): Promise<boolean>
  /** Push an editor buffer and return once didOpen/didChange was sent. Diagnostics settle asynchronously. */
  syncDocument(filePath: string, content: string): Promise<void>
  /** The editor saved an open document to disk — `textDocument/didSave`, never sent per keystroke. */
  saveDocument(filePath: string): Promise<void>
  /** Tell the server the editor closed the document. */
  closeDocument(filePath: string): Promise<void>
  /** Whether an editor/session still owns at least one open buffer on this client. */
  hasOpenDocuments(): boolean
  /** Disk changes nobody synced through here (`workspace/didChangeWatchedFiles`). */
  notifyWatchedFiles(changes: readonly LspWatchedFileChange[]): Promise<void>
  /** Hover type info at a position (textDocument/hover), null when none. */
  hover(filePath: string, position: LspPosition): Promise<LspHoverInfo | null>
  /** Completion items at a position (textDocument/completion). */
  completion(filePath: string, position: LspPosition): Promise<LspCompletionItem[]>
  /** Definition location(s) at a position (textDocument/definition). */
  definition(filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Reference locations at a position (textDocument/references). */
  references(filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Implementation location(s) at a position (textDocument/implementation); [] when unsupported/none. */
  implementation(filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Type-definition location(s) at a position (textDocument/typeDefinition); [] when unsupported/none. */
  typeDefinition(filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Incoming-call SITE locations at a position (prepareCallHierarchy → callHierarchy/incomingCalls); [] when unsupported/none. */
  incomingCalls(filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Outgoing-call CALLEE locations at a position (prepareCallHierarchy → callHierarchy/outgoingCalls); [] when unsupported/none. */
  outgoingCalls(filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Occurrences of the symbol under the cursor in this document (textDocument/documentHighlight). */
  documentHighlight(filePath: string, position: LspPosition): Promise<LspDocumentHighlight[]>
  /** Signature help (parameter hints) at a position (textDocument/signatureHelp). */
  signatureHelp(filePath: string, position: LspPosition): Promise<LspSignatureHelp | null>
  /** Inline inlay hints (type/parameter annotations) for a range (textDocument/inlayHint). */
  inlayHint(filePath: string, range: LspRange): Promise<LspInlayHint[]>
  /** Color literals in the document, for swatch decorations (textDocument/documentColor). */
  documentColor(filePath: string): Promise<LspColorInfo[]>
  /** Document symbols (outline) for a file (textDocument/documentSymbol). */
  documentSymbols(filePath: string): Promise<LspDocumentSymbol[]>
  /** Project-wide symbol search (workspace/symbol). */
  workspaceSymbols(query: string): Promise<LspWorkspaceSymbol[]>
  /** Validate renameability at a position (textDocument/prepareRename), null when not allowed. */
  prepareRename(filePath: string, position: LspPosition): Promise<LspPrepareRename | null>
  /** Compute the workspace edits to rename the symbol at a position (textDocument/rename). */
  rename(filePath: string, position: LspPosition, newName: string): Promise<LspWorkspaceEditFile[]>
  /** Whole-document formatting edits (textDocument/formatting); empty when unsupported. */
  formatDocument(filePath: string, options: LspFormattingOptions): Promise<LspTextEdit[]>
  /**
   * Code actions for a range, given the diagnostics to fix (textDocument/codeAction),
   * scoped by `kinds` (`context.only`; default `['quickfix']`).
   */
  codeAction(
    filePath: string,
    range: LspRange,
    diagnostics: LspDiagnostic[],
    kinds?: string[],
    trigger?: CodeActionTrigger,
  ): Promise<LspCodeAction[]>
  /** Resolve a code action's lazy `edit` (codeAction/resolve); returns the enriched action or null. */
  resolveCodeAction(action: LspCodeAction): Promise<LspCodeAction | null>
  diagnostics(): Record<string, LspDiagnostic[]>
  dispose(): void
}

export type ServerCapabilities = {
  textDocumentSync?: number | { change?: number; save?: boolean | { includeText?: boolean } }
  diagnosticProvider?: unknown
  [key: string]: unknown
}

export type CapabilityRegistration = {
  id: string
  method: string
  registerOptions?: {
    identifier?: string
    workspaceDiagnostics?: boolean
  }
}

export type DocumentDiagnosticReport = {
  items?: LspDiagnostic[]
  relatedDocuments?: Record<string, DocumentDiagnosticReport>
}

export type WorkspaceDiagnosticReport = {
  items?: {
    uri?: string
    items?: LspDiagnostic[]
  }[]
}

export type DiagnosticRequestResult = {
  handled: boolean
  matched: boolean
  byFile: Map<string, LspDiagnostic[]>
}

export type DiagnosticsListener = (filePath: string) => void
