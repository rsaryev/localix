import type {
  LspCodeAction,
  LspDiagnostic,
  LspPosition,
  LspHoverInfo,
  LspCompletionItem,
  LspLocation,
  LspDocumentHighlight,
  LspInlayHint,
  LspColorInfo,
  LspRange,
  LspSignatureHelp,
  LspDocumentSymbol,
  LspWorkspaceSymbol,
  LspPrepareRename,
  LspWorkspaceEditFile,
  LspTextEdit,
  LspFormattingOptions,
} from './lsp-client'
import type { CodeActionTrigger } from './lsp-protocol'
import type { DiagnosticsReport } from './diagnostics-report'
import type { LspServerDef } from './lsp-servers'
import type { LspWatchedFileChange } from './lsp-watched-files'

export type LspServerStatus = 'starting' | 'ready' | 'error'

export interface LspServerState {
  serverId: string
  serverName: string
  rootDir: string
  status: LspServerStatus
  errorCount: number
  warningCount: number
}

export interface LspManager {
  /**
   * Notify the LSP about one or more freshly-written files, WAIT for diagnostics,
   * and return a formatted error block to append to the mutating tool's result.
   * This is the primary path now that the standalone `lsp_diagnostics` tool is
   * gone — diagnostics ride along with write/edit instead of forcing
   * a separate model round-trip. Non-LSP file types resolve to an empty report
   * almost instantly (no server is started).
   */
  reportFileDiagnostics(
    filePaths: readonly string[],
    projectRoot: string,
  ): Promise<DiagnosticsReport>
  getDiagnostics(projectRoot: string): Record<string, LspDiagnostic[]>
  /** All current diagnostics for one file (every severity), '' when none. */
  getFileDiagnostics(projectRoot: string, filePath: string): LspDiagnostic[]
  /**
   * Open a document in the language server with EDITOR buffer content (not disk).
   * Returns after didOpen is dispatched; diagnostics continue asynchronously and
   * are exposed through getFileDiagnostics/onUpdate.
   */
  openDocument(projectRoot: string, filePath: string, content: string): Promise<LspDiagnostic[]>
  /** Push a fresh editor buffer (didChange); diagnostics continue asynchronously. */
  changeDocument(projectRoot: string, filePath: string, content: string): Promise<LspDiagnostic[]>
  /** The editor saved an open document to disk — announce `didSave` to every server holding it. */
  saveDocument(projectRoot: string, filePath: string): Promise<void>
  /** The editor closed the document — release server-side open state. */
  closeDocument(projectRoot: string, filePath: string): Promise<void>
  /** Hover type info at a position (null when no server / none). */
  hover(projectRoot: string, filePath: string, position: LspPosition): Promise<LspHoverInfo | null>
  /** Completion items at a position (empty when no server / none). */
  completion(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspCompletionItem[]>
  /** Definition location(s) at a position. */
  definition(projectRoot: string, filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Reference locations at a position. */
  references(projectRoot: string, filePath: string, position: LspPosition): Promise<LspLocation[]>
  /** Implementation location(s) at a position (textDocument/implementation); [] when unsupported / no server. */
  implementation(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspLocation[]>
  /** Type-definition location(s) at a position (textDocument/typeDefinition); [] when unsupported / no server. */
  typeDefinition(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspLocation[]>
  /** Incoming-call site locations at a position (prepareCallHierarchy → incomingCalls); [] when unsupported / no server. */
  incomingCalls(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspLocation[]>
  /** Outgoing-call callee locations at a position (prepareCallHierarchy → outgoingCalls); [] when unsupported / no server. */
  outgoingCalls(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspLocation[]>
  /** Occurrences of the symbol under the cursor in this document (textDocument/documentHighlight). */
  documentHighlight(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspDocumentHighlight[]>
  /** Signature help (parameter hints) at a position (null when no server / none). */
  signatureHelp(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspSignatureHelp | null>
  /** Inline inlay hints (type/parameter annotations) for a range (empty when no server / none). */
  inlayHint(projectRoot: string, filePath: string, range: LspRange): Promise<LspInlayHint[]>
  documentColor(projectRoot: string, filePath: string): Promise<LspColorInfo[]>
  /** Document symbols (outline) for a file (empty when no server / none). */
  documentSymbols(projectRoot: string, filePath: string): Promise<LspDocumentSymbol[]>
  /** Project-wide symbol search across every running server for the root (workspace/symbol). */
  workspaceSymbols(projectRoot: string, query: string): Promise<LspWorkspaceSymbol[]>
  /** Validate renameability at a position (textDocument/prepareRename), null when not allowed. */
  prepareRename(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
  ): Promise<LspPrepareRename | null>
  /** Workspace edits to rename the symbol at a position (textDocument/rename), [] when none. */
  rename(
    projectRoot: string,
    filePath: string,
    position: LspPosition,
    newName: string,
  ): Promise<LspWorkspaceEditFile[]>
  /** Whole-document formatting edits (textDocument/formatting), [] when unsupported. */
  formatDocument(
    projectRoot: string,
    filePath: string,
    options: LspFormattingOptions,
  ): Promise<LspTextEdit[]>
  /**
   * Code actions for a range (textDocument/codeAction), scoped by `kinds`
   * (`context.only`; default `['quickfix']`) — quick-fix, source, refactor, or a
   * specific sub-kind like `source.organizeImports`. The overlapping cached
   * diagnostics for the file become the request's `context.diagnostics`.
   */
  codeAction(
    projectRoot: string,
    filePath: string,
    range: LspRange,
    kinds?: string[],
    trigger?: CodeActionTrigger,
  ): Promise<LspCodeAction[]>
  /** Resolve a code action's lazy `edit` (codeAction/resolve), null when unavailable. */
  resolveCodeAction(
    projectRoot: string,
    filePath: string,
    action: LspCodeAction,
  ): Promise<LspCodeAction | null>
  /**
   * Files under the root changed on disk without passing through this manager (a terminal
   * edit, a build, a branch switch) — announced to the root's running servers as
   * `workspace/didChangeWatchedFiles`. See `lsp-watched-files.ts`.
   */
  notifyWatchedFiles(projectRoot: string, changes: readonly LspWatchedFileChange[]): Promise<void>
  getServerStates(projectRoot: string): LspServerState[]
  onUpdate(handler: (projectRoot: string, states: LspServerState[]) => void): () => void
  /**
   * Register the extra LSP servers contributed by enabled plugins for a project
   * root (from CC `lspServers` configs). REPLACES the previous set for that root;
   * pass `[]` to clear. Consulted after the built-in servers when picking a server
   * for a file, so a plugin can add language support (e.g. rust-analyzer) without a
   * core change. Already-running clients are left untouched (idempotent per turn).
   */
  setPluginServers(projectRoot: string, defs: LspServerDef[]): void
  dispose(): void
}
