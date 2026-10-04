import { pathToFileURL, fileURLToPath } from 'node:url'
import type { LspWatchedFileChange } from './lsp-watched-files'

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
  normalizeRelatedInformation,
  normalizeDiagnostic,
  diagnosticsOverlappingRange,
} from './lsp-normalize'

/** A secondary location a diagnostic points at (e.g. "first declaration is here").
 *  `file` is an absolute path (LSP `location.uri` is normalized to a path at ingest). */
export interface LspRelatedInformation {
  location: { file: string; range: { start: LspPosition; end: LspPosition } }
  message: string
}

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity?: number // 1=Error, 2=Warning, 3=Information, 4=Hint
  code?: string | number
  source?: string
  message: string
  /** Related locations (LSP `relatedInformation`) — clickable sub-rows in the UI. */
  relatedInformation?: LspRelatedInformation[]
  /**
   * LSP `DiagnosticTag`s: 1 = Unnecessary (an unused variable, import, parameter or
   * unreachable code — drawn faded), 2 = Deprecated (drawn struck through).
   */
  tags?: number[]
}

export interface LspPosition {
  line: number
  character: number
}

/** A start/end span in LSP coordinates. */
export interface LspRange {
  start: LspPosition
  end: LspPosition
}

/** Normalized hover result — markdown (or plaintext) ready for the editor tooltip. */
export interface LspHoverInfo {
  value: string
}

/** Normalized signature help — the active call's signatures + which one/param is active. */
export interface LspSignatureHelp {
  signatures: { label: string; parameters: string[]; documentation?: string }[]
  activeSignature: number
  activeParameter: number
}

/** A flattened document symbol (outline entry). `depth` drives outline indentation. */
export interface LspDocumentSymbol {
  name: string
  /** LSP SymbolKind (1–26). */
  kind: number
  /** 0-based line of the symbol's name. */
  line: number
  /** 0-based start character of the symbol's name (for exact-column reveal). */
  character: number
  /** 0-based last line of the symbol's full span (for enclosing-symbol lookup). */
  endLine: number
  detail?: string
  depth: number
}

/** A workspace-wide symbol (workspace/symbol) — raw, carrying the target uri. */
export interface LspWorkspaceSymbol {
  name: string
  /** LSP SymbolKind (1–26). */
  kind: number
  /** Enclosing container (class/namespace/file), when the server provides it. */
  containerName?: string
  uri: string
  /** 0-based line/character of the symbol's location. */
  line: number
  character: number
}

/** Normalized completion item — a thin subset the editor maps to a CM6 completion. */
export interface LspCompletionItem {
  label: string
  detail?: string
  /** LSP CompletionItemKind (1–25) — the editor maps it to an icon/type. */
  kind?: number
  insertText?: string
  documentation?: string
}

/** A resolved code location (definition / reference) — normalized from LSP. */
export interface LspLocation {
  uri: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
}

/**
 * A raw `CallHierarchyItem` (from `textDocument/prepareCallHierarchy`). Kept
 * loosely typed and round-tripped VERBATIM to `callHierarchy/incomingCalls` (its
 * `data` is server-opaque per spec), so we preserve unknown fields.
 */
export interface LspCallHierarchyItem {
  name?: string
  kind?: number
  uri: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  selectionRange?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  data?: unknown
  [key: string]: unknown
}

/**
 * A single occurrence of the symbol under the cursor within THIS document
 * (textDocument/documentHighlight). `kind` is the LSP DocumentHighlightKind —
 * 1 Text, 2 Read, 3 Write — so the editor can style writes distinctly.
 */
export interface LspDocumentHighlight {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  kind?: 1 | 2 | 3
}

/**
 * A normalized inlay hint (textDocument/inlayHint) — an inline annotation the
 * editor renders as faint non-editable text at `position`. `kind` is the LSP
 * InlayHintKind (1 Type, 2 Parameter) so the editor can style them apart; the
 * label is always flattened to a plain string (label-parts joined).
 */
export interface LspInlayHint {
  position: LspPosition
  label: string
  kind?: 1 | 2
  paddingLeft?: boolean
  paddingRight?: boolean
}

/**
 * A normalized `textDocument/documentColor` result — a color literal the editor
 * paints a swatch beside. `color` channels are 0..1 floats (LSP `Color`); `range`
 * is the source span of the literal so the swatch anchors to its start.
 */
export interface LspColorInfo {
  range: { start: LspPosition; end: LspPosition }
  color: { red: number; green: number; blue: number; alpha: number }
}

/** A single text edit (range → replacement) within a file. */
export interface LspTextEdit {
  range: { start: LspPosition; end: LspPosition }
  newText: string
}

/**
 * Why code actions were asked for: the person asked (`invoked` — a lightbulb click, Cmd+.) or
 * the editor asked on its own (`automatic` — the lightbulb probing every caret move). The
 * difference is load-bearing for vtsls: an INVOKED request cancels the running error check and
 * restarts it 200 ms later, and an absent trigger defaults to invoked. The automatic lightbulb
 * probe therefore restarted the check on every arrow key — part of the wait for a squiggle.
 */
export type CodeActionTrigger = 'invoked' | 'automatic'

/** Editor indentation prefs sent with a formatting request (LSP FormattingOptions). */
export interface LspFormattingOptions {
  tabSize: number
  insertSpaces: boolean
}

/** A WorkspaceEdit flattened to one entry per changed file. */
export interface LspWorkspaceEditFile {
  /** Absolute file path (from the edit's uri). */
  file: string
  edits: LspTextEdit[]
}

/** A `Command` a code action may carry (title + command id + opaque arguments). */
export interface LspCodeActionCommand {
  command: string
  title: string
  arguments?: unknown[]
}

/**
 * A normalized `textDocument/codeAction` result (a quick-fix). `edit` is present
 * when the server returned it eagerly; otherwise `data` is the opaque payload
 * echoed back on `codeAction/resolve` to obtain the edit lazily (tsserver/vtsls
 * populate edits this way). `command` is kept for provenance but MVP applies the
 * `edit` path only.
 */
export interface LspCodeAction {
  title: string
  /** CodeActionKind (e.g. `quickfix`, `quickfix.import`). */
  kind?: string
  isPreferred?: boolean
  /** Flattened workspace edit, when the server resolved it eagerly. */
  edit?: LspWorkspaceEditFile[]
  /** A command form (rare for quickfix); provenance only in the MVP. */
  command?: LspCodeActionCommand
  /** Opaque server payload, round-tripped verbatim on `codeAction/resolve`. */
  data?: unknown
}

/**
 * Normalized `textDocument/prepareRename` result. `range` is the symbol span the
 * rename input should cover (null when the server returns `{defaultBehavior:true}`
 * — the editor then computes the word at the cursor itself). `null` (not this
 * shape) means rename is not allowed / no provider.
 */
export interface LspPrepareRename {
  range: { start: LspPosition; end: LspPosition } | null
  placeholder?: string
}

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

export type DiagnosticsListener = (filePath: string) => void

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
