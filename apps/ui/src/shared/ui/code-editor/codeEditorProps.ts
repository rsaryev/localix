import type {
  ApplyCodeActionSource,
  CodeActionSource,
  CompletionSource,
  DefinitionSource,
  DefinitionTargetSource,
  DocumentColorSource,
  DocumentHighlightSource,
  EditorContentChange,
  EditorCursorStatus,
  EditorDiagnostic,
  EditorRenameResult,
  EditorSuggestion,
  EditorTextSelection,
  FormatSource,
  FormatTextSource,
  HoverSource,
  InlayHintSource,
  PrepareRenameSource,
  RenameSource,
  SignatureHelpSource,
} from './types'
import type { DirtyChange, DirtyDiffFeed } from './dirtyDiffGutter'
import type { InlineBlameSource } from './inlineBlame'
import type { StickySymbol } from './stickyScroll'
import type { ViewStateBridge } from './viewState'
import type { MonacoEditorExtension } from './monaco/extensions'
import type { CodeEditorActionProps } from './monaco/actions'
import type { NextEditSource } from './nextEditPrediction'
import type { EditorHandle } from './editorHandle'

export interface CodeEditorProps extends CodeEditorActionProps {
  value: string
  language?: string
  readOnly?: boolean
  followTail?: boolean
  autoFocus?: boolean
  placeholder?: string
  /** The new full document, plus the deltas that produced it (absent for the very
   *  first/programmatic emissions). Consumers that only need to know WHAT changed
   *  should read `changes` instead of walking `value`. */
  onChange?: (value: string, changes?: readonly EditorContentChange[]) => void
  diagnostics?: EditorDiagnostic[]
  dirtyDiff?: DirtyDiffFeed
  /** Lines an external write just changed under this buffer — highlighted until the next user edit. */
  externalChanges?: readonly DirtyChange[]
  scrollbarMarkersEnabled?: boolean
  bracketColorizationEnabled?: boolean
  /** Compact data editors can keep all available height for the document. */
  stickyScrollEnabled?: boolean
  hoverSource?: HoverSource
  completionSource?: CompletionSource
  signatureHelpSource?: SignatureHelpSource
  nextEditSource?: NextEditSource
  nextEdit?: EditorSuggestion[] | null
  onNextEdit?: (suggestions: EditorSuggestion[] | null) => void
  onCursorLineChange?: (line: number) => void
  onCursorPositionChange?: (position: EditorCursorStatus) => void
  onSelectionChange?: (selection: EditorTextSelection | null) => void
  onEditorReady?: (api: EditorHandle) => void
  onScroll?: (percent: number) => void
  scrollSyncHost?: HTMLElement | null
  stickySymbols?: StickySymbol[]
  onFixRequest?: (diagnostic: EditorDiagnostic) => void
  definitionSource?: DefinitionSource
  definitionTargetSource?: DefinitionTargetSource
  documentHighlightSource?: DocumentHighlightSource
  inlayHintSource?: InlayHintSource
  blameSource?: InlineBlameSource
  documentColorSource?: DocumentColorSource
  prepareRenameSource?: PrepareRenameSource
  renameSource?: RenameSource
  onRenameApplied?: (result: EditorRenameResult) => void
  formatSource?: FormatSource
  formatText?: FormatTextSource
  codeActionSource?: CodeActionSource
  applyCodeActionSource?: ApplyCodeActionSource
  onCodeActionApplied?: (result: EditorRenameResult) => void
  onPeekDefinition?: (location: { file: string; line: number; character?: number }) => void
  initialLine?: number
  initialColumn?: number
  initialEndLine?: number
  initialEndColumn?: number
  revealKey?: number
  extensions?: MonacoEditorExtension[]
  viewState?: ViewStateBridge
  className?: string
  ariaLabel?: string
}
