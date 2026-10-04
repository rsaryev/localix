/**
 * Public type surface for the {@link CodeEditor} primitive — kept deliberately
 * decoupled from the backend (`features`/`shared/api`) so this lowest-FSD-layer
 * editor imports nothing upward. The feature wrapper converts its own LSP shapes
 * into these.
 */
import type { BufferEdit } from '@localixai/api/lsp-edits'

/**
 * A diagnostic in LSP coordinates (0-based line/character), kept deliberately
 * decoupled from the backend `LspDiagnostic` type so this primitive imports
 * nothing from `features`. The feature wrapper converts LSP → this shape.
 */
export interface EditorDiagnostic {
  line: number
  character: number
  endLine: number
  endCharacter: number
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string
  source?: string
  /** Server rule identifier, e.g. `2304` — rendered as `source(code)` (`ts(2304)`). */
  code?: string | number
  /**
   * How the span itself is drawn, beyond its squiggle: `unnecessary` fades it (an unused
   * variable, import, parameter, unreachable code), `deprecated` strikes it through.
   */
  tags?: EditorDiagnosticTag[]
}

export type EditorDiagnosticTag = 'unnecessary' | 'deprecated'

/**
 * `source(code)` label for a diagnostic (e.g. `ts(2304)`, `eslint`,
 * or a bare `2304`). Returns `undefined` when neither is present. Shared by the
 * editor lint tooltip and the Problems panel so both read identically.
 */
export function formatDiagnosticSource(
  source?: string,
  code?: string | number,
): string | undefined {
  const c = code === undefined || code === null || code === '' ? undefined : String(code)
  if (source && c) return `${source}(${c})`
  return source || c
}

/** A document position in LSP coordinates (0-based), used by the async sources. */
export interface EditorPosition {
  line: number
  character: number
}

/** One go-to-definition target in editor-agnostic, 0-based coordinates. */
export interface EditorDefinition {
  file: string
  line: number
  character?: number
}

export type DefinitionSource = (pos: EditorPosition) => Promise<EditorDefinition[]>

/** Loads a definition target so standalone Monaco can render its link preview and peek editor. */
export type DefinitionTargetSource = (
  file: string,
  signal: AbortSignal,
) => Promise<{ content: string; language: string } | null>

/** Caret position + selection size for the editor status bar (1-based line/column). */
export interface EditorCursorStatus {
  line: number
  column: number
  /** Number of selected characters across the primary selection (0 = no selection). */
  selectedChars: number
  /** Number of lines spanned by the selection (0 = no selection). */
  selectedLines: number
}

/** Exact primary editor selection in normalized document order (1-based positions). */
export interface EditorTextSelection {
  text: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/**
 * ONE replacement inside a content-change event, in editor-agnostic 0-based lines and
 * PRE-edit coordinates: the range `[startLine, endLine]` was replaced by `text`.
 *
 * A change event carries a LIST of these — a multi-cursor edit reports one per caret in
 * a single event — which is what lets a consumer that only needs to know WHAT changed
 * skip re-reading the whole document (the same contract as Monaco's
 * model content-changed event).
 */
export interface EditorContentChange {
  startLine: number
  endLine: number
  text: string
}

export interface EditorCompletionItem {
  label: string
  detail?: string
  /** LSP CompletionItemKind (1–25). */
  kind?: number
  insertText?: string
  /** How `insertText` is interpreted. Omitted keeps legacy `$0` snippet detection. */
  insertTextFormat?: 'plainText' | 'snippet'
  /** Explicit text span replaced on accept; defaults to the word at the cursor. */
  range?: { start: EditorPosition; end: EditorPosition }
  /** Alternative text used by native completion filtering. */
  filterText?: string
  /** Stable native sort key (lexicographic). */
  sortText?: string
  /** Ask the editor to initially select this item when it is the best match. */
  preselect?: boolean
  /** Single characters that accept this item before inserting the typed character. */
  commitCharacters?: string[]
  /** Editor command invoked after accepting the item. */
  command?: { id: string; title?: string; arguments?: unknown[] }
  documentation?: string
}

/** Async hover provider — returns markdown/plaintext or null. */
export type HoverSource = (pos: EditorPosition) => Promise<{ value: string } | null>
/** Async completion provider — returns candidate items for the word at `pos`. */
export type CompletionSource = (pos: EditorPosition) => Promise<EditorCompletionItem[]>

/** Signature help (parameter hints) for the call at `pos`. */
export interface EditorSignatureHelp {
  signatures: { label: string; parameters: string[]; documentation?: string }[]
  activeSignature: number
  activeParameter: number
}
/** Async signature-help provider — returns the active call's signatures or null. */
export type SignatureHelpSource = (pos: EditorPosition) => Promise<EditorSignatureHelp | null>

/**
 * Validate a rename at `pos`. `range` (when present) is the symbol span the inline
 * input should cover; `null` range means the editor computes the word at the
 * cursor. A `null` result means rename is not allowed (no provider / rejected).
 */
export interface EditorRenamePrepare {
  range: { start: EditorPosition; end: EditorPosition } | null
  placeholder?: string
}
export type PrepareRenameSource = (pos: EditorPosition) => Promise<EditorRenamePrepare | null>

/**
 * A rename's or a code action's outcome: `bufferEdits` for documents an editor holds open
 * (applied to those buffers through `bufferEditBus`), `changedFiles` for what was written to
 * disk. See `@localixai/api/lsp-edits` for why an open document is never edited on disk.
 */
export interface EditorRenameResult {
  changedFiles: string[]
  files: { file: string; content: string }[]
  bufferEdits?: BufferEdit[]
}
export type RenameSource = (pos: EditorPosition, newName: string) => Promise<EditorRenameResult>

/** Format the open document; its edits for the live buffer, or null when nothing changed / unsupported. */
export type FormatSource = () => Promise<BufferEdit | null>

/**
 * Pure in-memory document formatter. Monaco applies the returned text as a native
 * formatting edit, preserving its standard command, selection and undo behavior.
 */
export type FormatTextSource = (text: string) => string | Promise<string>

/**
 * A code action surfaced in the editor (quick-fix, organize-imports, source, or
 * refactor). `title` is the label shown; the remaining fields are opaque payload
 * the editor round-trips back to {@link ApplyCodeActionSource} verbatim (the
 * feature wrapper maps LSP → this).
 */
export interface EditorCodeAction {
  title: string
  kind?: string
  isPreferred?: boolean
  edit?: unknown
  command?: unknown
  data?: unknown
}
/**
 * Fetch code actions for a range (cursor selection or word at cursor). `kinds`
 * scopes the request (`context.only`) — e.g. `['quickfix']`, `['source.organizeImports']`,
 * or `['source','refactor']`; omitted → the backend defaults to quick-fix.
 */
/**
 * `automatic` is the editor probing for a lightbulb on its own; `invoked` is the person asking.
 * Servers treat them differently (an invoked request can cancel a running error check), so the
 * editor always says which it is.
 */
export type CodeActionSource = (
  range: { start: EditorPosition; end: EditorPosition },
  kinds?: string[],
  trigger?: 'invoked' | 'automatic',
) => Promise<EditorCodeAction[]>
/** Apply a chosen code action server-side; returns the changed files + their new content. */
export type ApplyCodeActionSource = (action: EditorCodeAction) => Promise<EditorRenameResult>

/**
 * One granular change block (quick-diff hunk) of the open file vs the last commit,
 * for the inline peek + per-hunk revert. Mirrors the backend `RepoFileHunk`; the
 * editor treats it as opaque and hands it back to {@link RevertHunkSource}.
 */
export interface EditorHunk {
  index: number
  header: string
  /** 1-based first modified line the change occupies (gutter-aligned). */
  modifiedStart: number
  modifiedEnd: number
  /** Original lines a revert restores. */
  oldLines: string[]
  /** New lines a revert removes. */
  newLines: string[]
}
/** Resolve the change hunk covering a 1-based line (null when none / not tracked). */
export type HunkSource = (line: number) => Promise<EditorHunk | null>
/** Revert one hunk back to its committed state (throws on failure). */
export type RevertHunkSource = (hunk: EditorHunk) => Promise<void>

/** A selection a user wants to comment on (0-based line range + the selected text). */
export interface EditorSelectionRange {
  line: number
  endLine: number
  text: string
}

/** A 0-based line range that already has a pending comment (highlighted in the editor). */
export interface CommentedRange {
  line: number
  endLine: number
  /** When set, a gutter marker on the start line opens an inline editor for this comment. */
  id?: string
  body?: string
}

/**
 * One occurrence of the symbol under the cursor within the open document. `kind`
 * is the LSP DocumentHighlightKind (1 Text, 2 Read, 3 Write) — the editor styles
 * writes more strongly than reads. Positions are 0-based LSP coordinates.
 */
export interface EditorDocumentHighlight {
  range: { start: EditorPosition; end: EditorPosition }
  kind?: number
}
/**
 * Async occurrence provider — returns the symbol's occurrences in THIS document at
 * `pos` (semantic, from the language server), or an empty list when there's none.
 */
export type DocumentHighlightSource = (pos: EditorPosition) => Promise<EditorDocumentHighlight[]>

/**
 * An inlay hint — a faint, non-editable inline annotation (inferred type or
 * parameter name) the editor renders at `position`. `kind` mirrors the LSP
 * InlayHintKind (1 Type, 2 Parameter); `paddingLeft`/`paddingRight` ask for a
 * thin gap on that side so the hint doesn't touch the surrounding code.
 */
export interface EditorInlayHint {
  position: EditorPosition
  label: string
  kind?: number
  paddingLeft?: boolean
  paddingRight?: boolean
}
/**
 * Async inlay-hint provider — returns the hints whose position falls within the
 * requested range (the editor asks for its visible viewport), or an empty list.
 */
export type InlayHintSource = (range: {
  start: EditorPosition
  end: EditorPosition
}) => Promise<EditorInlayHint[]>

/**
 * A color literal the editor paints a swatch beside. `range` is the source span
 * of the literal (the swatch anchors to its start); `color` channels are 0..1
 * floats, mirroring the LSP `Color` shape.
 */
export interface EditorColorInfo {
  range: { start: EditorPosition; end: EditorPosition }
  color: { red: number; green: number; blue: number; alpha: number }
}
/**
 * Async document-color provider — returns every color literal in the document
 * (textDocument/documentColor is whole-file, unlike the viewport-scoped inlay
 * hints), or an empty list when the server has no color provider.
 */
export type DocumentColorSource = () => Promise<EditorColorInfo[]>

/** A reference location for the peek list (absolute path + 0-based line + preview). */
export interface EditorReference {
  file: string
  fileLabel: string
  line: number
  character: number
  preview: string
}

/**
 * A pending, anchored inline edit to render in
 * the editor — a subtle highlight over its anchor range plus a block widget below.
 * A `suggestion` shows a proposed-replacement mini-diff with Apply / Reject; a
 * `comment` shows its note with a Resolve action. Kept framework-free (1-based
 * inclusive lines, plain text) so this lowest-layer editor never imports the backend
 * `SessionSuggestion` shape; the feature wrapper maps its own type into this. (Free
 * comments with no file anchor are NOT rendered here — they live only in the Review tab.)
 */
export interface EditorSuggestion {
  id: string
  /** 'suggestion' (has a replacement) or 'comment' (note only). */
  kind: 'suggestion' | 'comment'
  /**
   * Which subsystem produced this decoration — drives the inline label, the AI
   * provenance affordance, and the ARIA description. Absent → `'review'` (the durable
   * an inline edit), so callers can distinguish its source. Edit
   * Edit prediction is AI-generated and labelled accordingly.
   */
  source?: 'review' | 'edit-prediction'
  /** 1-based inclusive start line of the anchor. */
  startLine: number
  /** 1-based inclusive end line of the anchor. */
  endLine: number
  /** The file's exact text across the anchor when created — compared to the live
   *  doc to flag drift ("may be outdated") for suggestions. */
  original: string
  /** The proposed replacement text for the anchored range — suggestions only. */
  replacement?: string
  /** The comment/note text (the body for a comment; an optional note for a suggestion). */
  note?: string
}
