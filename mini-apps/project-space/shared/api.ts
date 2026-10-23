import type { SpaceDocument, SpaceIssue } from './format/document'
import type { OpResult } from './ops/contract'

/**
 * What the board's routes answer, in the one place both halves read it. A snapshot is the whole
 * board plus what the view needs beside it: whether it may be written, what cannot be read, which
 * references are gone, and whether the person has anything to undo or redo.
 */
export interface SpaceView {
  space: SpaceDocument
  issues: SpaceIssue[]
  writable: boolean
  revision: string
  canUndo: boolean
  canRedo: boolean
  /** Subscribe only when the mounted backend advertises its live stream. Older hosts omit this. */
  liveUpdates?: boolean
  missing: string[]
  /** When each referenced file last changed on disk, by element id. */
  stamps: Record<string, number>
}

export type AppliedView = SpaceView & { results: OpResult[] }
export type SteppedView = SpaceView & { conflicts: string[] }

export interface FileText {
  text: string | null
  binary: boolean
  truncated: boolean
}

export interface FolderListing {
  entries: { name: string; kind: 'file' | 'folder' }[]
  total: number
}
