import type { LspDiagnostic, LspPosition } from './lsp-response-types'
import type { BufferEdit } from './lsp-edits'

/** A resolved code location (absolute path + 0-based position). */
export interface CodeLocation {
  file: string
  line: number
  character: number
}

/** A reference with display label + a one-line preview of the target line. */
export interface CodeReference extends CodeLocation {
  fileLabel: string
  preview: string
}

/** A project-wide symbol hit (workspace/symbol) — name + kind + resolved location. */
export interface WorkspaceSymbol extends CodeLocation {
  name: string
  /** LSP SymbolKind (1–26). */
  kind: number
  /** Enclosing container (class/namespace/file), when the server provides it. */
  containerName?: string
}

/**
 * Per-file diagnostics push routed to one session's event stream. Owned by this feature so
 * the LSP feature owns its data shape and imports nothing from `features/chat`;
 * the transport layer (bootstrap) wraps this into the chat `lsp.diagnostics`
 * stream event.
 */
export interface LspDiagnosticsPush {
  file: string
  diagnostics: LspDiagnostic[]
}

/** Result of `prepareRename` — the symbol span to rename + a placeholder name for the input. */
export interface RenamePrepare {
  /** Span to cover with the rename input (null = server gave `defaultBehavior`; editor uses the word at cursor). */
  range: { start: LspPosition; end: LspPosition } | null
  placeholder?: string
}

/** A format is always a buffer edit: the editor that asked applies it to its live text. */
export type FormatResult = BufferEdit

/**
 * Result of a rename or an applied code action. Files an editor holds open come back as
 * `bufferEdits` for that editor to apply; `changedFiles`/`files` are the ones committed to disk.
 */
export interface RenameResult {
  changedFiles: string[]
  /** Per changed file: its new content, plus a unified diff of the change (for a card / review). */
  files: { file: string; content: string; diff: string }[]
  /** Edits for documents an editor holds open, computed against — and fingerprinted by — that buffer. */
  bufferEdits?: BufferEdit[]
  /**
   * Files the edit targeted but could NOT be written, with why. Absent on a clean commit.
   *
   * A workspace edit is committed file-by-file with no rollback, so a failure partway leaves the
   * workspace INCONSISTENT — a rename applied to 2 of 5 files is broken code. That outcome is
   * reportable rather than avoidable here, so it must be reported: the caller names the split
   * instead of surfacing an opaque throw.
   */
  failed?: { file: string; reason: string }[]
}
