import type { EditorHunk } from './CodeEditor'
import type { DirtyDiffFeed } from './dirtyDiffGutter'
import type { InlineBlameSource } from './inlineBlame'

/** Optional file-history adornments supplied through an editor enhancer. */
export interface FileHistoryEnhancement {
  dirtyDiff?: {
    feed: DirtyDiffFeed | undefined
    hunkSource: (line: number) => Promise<EditorHunk | null>
    revertHunk: (hunk: EditorHunk) => Promise<void>
    onHunkReverted: () => void
  }
  blameSource?: InlineBlameSource
}
