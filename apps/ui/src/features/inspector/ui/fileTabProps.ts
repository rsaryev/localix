import type { ReactNode } from 'react'
import type { FileHistoryEnhancement } from '@/shared/ui/code-editor/fileEnhancement'
import type {
  EditorCompletionItem,
  EditorPosition,
  FormatTextSource,
} from '@/shared/ui/code-editor/CodeEditor'
import type { MonacoEditorExtension } from '@/shared/ui/code-editor/monaco/extensions'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { NextEditContextSource } from './useFileLsp'

export interface FileTabProps {
  /** The grid WorkItem id backing this tab — reported to the grid store so an
   *  unsaved buffer shows a dirty dot on the tab. Omitted → no dot (e.g. previews). */
  itemId?: string
  path: string
  /** The session this file tab BELONGS to (its grid scope). Bind file I/O / LSP /
   *  diagnostics to it, not the globally-active session — with warm keep-alive a
   *  background session's file tab is mounted (hidden), and reading the active
   *  session would fetch/save against the WRONG workspace. Required: a caller with no
   *  session has no workspace to open a file from, and renders no file tab. */
  sessionId: string
  /** 1-indexed line to scroll to once loaded (from a `path:line` link). */
  line?: number
  /** 0-based start character within `line` — places the cursor on the exact token
   *  (e.g. a diagnostic's position) instead of the line start. */
  column?: number
  /** 1-indexed end line + 0-based end character; when present the editor selects
   *  [start, end] (e.g. a diagnostic's exact range) rather than only the cursor. */
  endLine?: number
  endColumn?: number
  /** Monotonic nonce that changes on every open request, so re-opening the same
   *  path+line still re-reveals (scroll + flash). */
  revealAt?: number
  /** Extra completion provider merged AHEAD of the LSP one, given the live document
   *  text + position — used to layer schema-aware SQL autocomplete onto a .sql file.
   *  (The host injects the live buffer, so the source stays a pure text→items fn.) */
  auxCompletionSource?: (
    text: string,
    pos: EditorPosition,
  ) => EditorCompletionItem[] | Promise<EditorCompletionItem[]>
  /** Opaque domain-resource references resolved server-side for edit prediction. */
  nextEditContextSource?: NextEditContextSource
  /** A panel docked below the editor (e.g. the SQL run bar + results for a .sql file). */
  bottomPanel?: ReactNode
  /** Fired on ⌘/Ctrl+Enter in the editor with the current run context (used to run the
   *  SQL statement under the cursor). */
  onRun?: (ctx: EditorRunContext) => void
  /** Called once with a getter for the current editor run context, so a docked panel's
   *  own Run button can trigger the same run as the ⌘/Ctrl+Enter shortcut. */
  bindRunContext?: (get: () => EditorRunContext) => void
  /** Extra mount-time Monaco extensions (e.g. the SQL active-statement highlight on a
   *  .sql file). Pass a stable value — applied once at mount. */
  extensions?: MonacoEditorExtension[]
  /** Optional in-memory formatter contributed by a specialized file editor. */
  formatText?: FormatTextSource
  /** Host-owned live-context publisher scoped to this file tab. */
  publishMessageContext?: PublishMessageContext
}

export type SessionFileTabProps = FileTabProps & {
  /** File-history adornments from whatever claims this path — empty when nothing does. */
  enhancement: FileHistoryEnhancement
}

/** The editor state a Run action needs: the whole document, the current selection, and
 *  the caret offset (to resolve the statement under the cursor). */
export interface EditorRunContext {
  fullText: string
  selectedText: string
  cursorOffset: number
  /** Run Monaco's native Format Document command for this editor. */
  formatDocument: () => Promise<void>
}
