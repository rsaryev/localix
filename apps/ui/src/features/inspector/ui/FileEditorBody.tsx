import type { MutableRefObject, ReactNode } from 'react'
import { MarkdownRenderer } from '@/shared/ui/MarkdownRenderer'
import type { EditorHandle } from '@/shared/ui/code-editor/CodeEditor'
import type { MergeConflictState } from '../model/useMergeConflicts'
import { MergeConflictBar } from './MergeConflictBar'

interface FileEditorBodyProps {
  mergeConflicts: MergeConflictState
  editorApiRef: MutableRefObject<EditorHandle | null>
  /** Markdown preview with the editor hidden. */
  showPreviewOnly: boolean
  /** Markdown split: editor + scroll-synced preview. */
  showSplit: boolean
  previewText: string
  setEditorHostEl: (el: HTMLDivElement | null) => void
  setPreviewEl: (el: HTMLDivElement | null) => void
  /** The code editor, mounted in the editor host unless preview-only. */
  children: ReactNode
}

/** The editor area: merge-conflict resolver, the editor host and the markdown previews. */
export function FileEditorBody({
  mergeConflicts,
  editorApiRef,
  showPreviewOnly,
  showSplit,
  previewText,
  setEditorHostEl,
  setPreviewEl,
  children,
}: FileEditorBodyProps) {
  return (
    <div className="relative flex min-h-0 flex-1">
      {/* A file carrying conflict markers gets its resolver, whatever put them there — a
          merge, a rebase, a half-applied patch. Nothing here knows about git. */}
      {mergeConflicts.conflicts.length > 0 && (
        <MergeConflictBar
          conflict={mergeConflicts.conflicts[mergeConflicts.index]!}
          index={mergeConflicts.index}
          count={mergeConflicts.conflicts.length}
          onNavigate={(next) => {
            const line = mergeConflicts.navigate(next)
            if (line !== null) editorApiRef.current?.revealLine(line)
          }}
          onResolve={mergeConflicts.resolve}
        />
      )}
      {showPreviewOnly ? (
        <div className="h-full flex-1 overflow-auto px-4 py-4 text-sm text-foreground scrollbar-thin">
          <MarkdownRenderer>{previewText}</MarkdownRenderer>
        </div>
      ) : (
        <div ref={setEditorHostEl} className="relative h-full min-w-0 flex-1">
          {children}
        </div>
      )}
      {showSplit && (
        // Scroll-synced rendered preview (right half). Observes its own sync
        // attribute + publishes to the editor host (see useSplitScrollSync).
        <div
          ref={setPreviewEl}
          className="h-full flex-1 overflow-auto border-l border-border-soft px-4 py-4 text-sm text-foreground scrollbar-thin"
        >
          <MarkdownRenderer>{previewText}</MarkdownRenderer>
        </div>
      )}
    </div>
  )
}
