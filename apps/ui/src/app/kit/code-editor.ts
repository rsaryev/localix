export type {
  CompletionSource,
  EditorCompletionItem,
  EditorDiagnostic,
  EditorPosition,
} from '@/shared/ui/code-editor/types'
export { CodeEditor } from '@/shared/ui/code-editor/CodeEditor'
export type {
  EditorHandle,
  EditorHunk,
  EditorSuggestion,
  NextEditRequest,
  NextEditSource,
} from '@/shared/ui/code-editor/CodeEditor'
export { mergeDirtyChanges, parseUnifiedDiff } from '@/shared/ui/code-editor/dirtyDiffGutter'
export type { DirtyChange, DirtyDiffFeed } from '@/shared/ui/code-editor/dirtyDiffGutter'
export type { InlineBlameLine, InlineBlameSource } from '@/shared/ui/code-editor/inlineBlame'
export { computeWordDiffMarks } from '@/shared/ui/code-editor/wordDiffMarks'
export type { MonacoEditorExtension } from '@/shared/ui/code-editor/monaco/extensions'
