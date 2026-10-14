import type { LspManager } from './lsp-manager-types'
import type {
  LspCodeAction,
  LspPosition,
  LspRange,
  LspHoverInfo,
  LspCompletionItem,
  LspSignatureHelp,
  LspInlayHint,
  LspColorInfo,
  LspDocumentSymbol,
  LspDocumentHighlight,
  LspFormattingOptions,
  CodeActionTrigger,
} from './lsp-response-types'
import type {
  CodeLocation,
  CodeReference,
  WorkspaceSymbol,
  LspDiagnosticsPush,
  RenamePrepare,
  FormatResult,
  RenameResult,
} from './service-result-types'

export interface LspDocumentService {
  /** Editor opened a file — sync its buffer to the server and push diagnostics.
   *  `consumerId` identifies the HOLDER (one per connection): the document stays open
   *  on the server until every holder has closed it. */
  open(
    userId: string,
    sessionId: string,
    file: string,
    content: string,
    consumerId?: string,
  ): Promise<void>
  /** Editor buffer changed — re-sync and push fresh diagnostics. */
  change(userId: string, sessionId: string, file: string, content: string): Promise<void>
  /**
   * The text of `file` as an editor this user holds it open — possibly UNSAVED — or undefined
   * when no editor has it open. Read by the agent's file tools so a write the person's unsaved
   * edits will collide with says so (`chat/runtime/run/editor-buffer-note.ts`).
   */
  openBufferText(this: void, userId: string, file: string): string | undefined
  /** Editor wrote the open buffer to disk — `didSave`, which check-on-save servers act on. */
  save(userId: string, sessionId: string, file: string): Promise<void>
  /** Editor closed the file for ONE holder — server state is released only once no
   *  other holder (and no other session) still has it open. */
  close(userId: string, sessionId: string, file: string, consumerId?: string): Promise<void>
  /** Hover type info at a position (request/response). */
  hover(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspHoverInfo | null>
  /** Completion items at a position (request/response). */
  completion(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspCompletionItem[]>
  /** Signature help (parameter hints) at a position (request/response). */
  signatureHelp(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspSignatureHelp | null>
  /** Inline inlay hints (type/parameter annotations) for a range (request/response). */
  inlayHint(
    userId: string,
    sessionId: string,
    file: string,
    range: LspRange,
  ): Promise<LspInlayHint[]>
  /** Color literals in the document for swatch decorations (request/response). */
  documentColor(userId: string, sessionId: string, file: string): Promise<LspColorInfo[]>
  /** Document symbols (outline) for a file (request/response). */
  documentSymbols(userId: string, sessionId: string, file: string): Promise<LspDocumentSymbol[]>
  /** Project-wide symbol search (workspace/symbol) backing the ⌘T palette. */
  workspaceSymbols(userId: string, sessionId: string, query: string): Promise<WorkspaceSymbol[]>
  /** Definition locations at a position. Multiple targets stay intact so the editor can peek. */
  definition(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeLocation[]>
  /** Implementation locations at a position (with previews); [] when unsupported / none. The
   *  editor jumps to the single result or opens the references-style peek when there are several. */
  implementation(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]>
  /** Type-definition locations at a position (with previews); [] when unsupported / none. The
   *  editor jumps to the single result or opens the references-style peek when there are several. */
  typeDefinition(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]>
  /** Reference locations at a position (with previews, for the references list). */
  references(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<CodeReference[]>
  /** Occurrences of the symbol under the cursor in this document (for occurrence highlighting). */
  documentHighlight(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<LspDocumentHighlight[]>
  /** Validate renameability at a position (textDocument/prepareRename), null when not allowed. */
  prepareRename(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
  ): Promise<RenamePrepare | null>
  /**
   * Rename the symbol at a position across the workspace. Files an editor holds open
   * come back as `bufferEdits`; the rest are committed to disk through the injected
   * file-write primitive (the same one the editor save uses).
   */
  rename(
    userId: string,
    sessionId: string,
    file: string,
    position: LspPosition,
    newName: string,
  ): Promise<RenameResult>
  /**
   * Format the whole OPEN document (textDocument/formatting) and return the edits
   * for the editor's buffer, fingerprinted by the text they were computed against.
   * Null when the document is not open, there were no edits, or no formatter.
   */
  formatDocument(
    userId: string,
    sessionId: string,
    file: string,
    options: LspFormattingOptions,
  ): Promise<FormatResult | null>
  /**
   * Code actions for a range (textDocument/codeAction), scoped by `kinds`
   * (default `['quickfix']`) — also `['source.organizeImports']`, `['source','refactor']`, etc.
   */
  codeAction(
    userId: string,
    sessionId: string,
    file: string,
    range: LspRange,
    kinds?: string[],
    trigger?: CodeActionTrigger,
  ): Promise<LspCodeAction[]>
  /**
   * Apply a code action: resolve its lazy `edit` if needed (codeAction/resolve),
   * then route its WorkspaceEdit exactly as `rename` does (open buffers get edits,
   * the rest commit to disk). Command-only actions with no edit degrade gracefully
   * to an empty result.
   */
  applyCodeAction(
    userId: string,
    sessionId: string,
    file: string,
    action: LspCodeAction,
  ): Promise<RenameResult>
  dispose(): void
}

export interface LspServiceDeps {
  lspManager: LspManager
  /**
   * Resolve a session's project root WITH an ownership check (throws/ rejects for
   * a session the user doesn't own). Injected so this stays decoupled from chat.
   */
  resolveProjectRoot: (userId: string, sessionId: string) => Promise<string>
  /** Emit a diagnostics push onto the given session's event stream. */
  publish: (userId: string, sessionId: string, push: LspDiagnosticsPush) => void
  /**
   * Persist full file content through the editor's locked, optimistic-concurrency
   * write path (injected so this stays decoupled from `features/chat`). Used to
   * commit a rename's WorkspaceEdit to disk via the SAME primitive an editor save
   * uses, so its file-change tracking stays coherent. Returns the new content hash.
   */
  writeFile: (
    userId: string,
    sessionId: string,
    file: string,
    content: string,
    baseHash: string,
  ) => Promise<{ hash: string }>
}

export interface OpenDoc {
  userId: string
  sessionId: string
  projectRoot: string
  file: string
  /**
   * Who currently holds this buffer open. A (session, file) pair is NOT one consumer:
   * there is one WebSocket per browser tab, so two tabs on the same file each open it,
   * and a split editor group does the same over one socket. They collapsed into a
   * single entry here, so whichever one closed FIRST told the language server to close
   * the document out from under the others.
   */
  consumers: Set<string>
  /** JSON of the last payload sent, to skip redundant re-pushes. */
  lastSent: string
  /**
   * Latest didOpen/didChange round-trip for this buffer. The realtime transport
   * acknowledges document sync immediately, so editor intelligence can otherwise
   * race vtsls startup and ask for a definition before the document exists there.
   * Chaining changes also keeps monotonically-increasing LSP versions in order.
   */
  syncing: Promise<void>
  /**
   * The text the language server holds for this buffer once `syncing` settles — what every
   * range it answers with is computed against, so it is what `edit-routing.ts` fingerprints
   * when an edit goes back to the editor's buffer instead of to disk.
   */
  text: string
}
