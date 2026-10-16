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
