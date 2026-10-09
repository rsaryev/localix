export type PatchHunk =
  | { kind: 'add'; path: string; contents: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; movePath?: string; chunks: UpdateChunk[] }

export interface UpdateChunk {
  changeContext?: string
  oldLines: string[]
  newLines: string[]
  isEndOfFile: boolean
}

/** Running tallies of the leniencies the parse had to apply, reported back as notes. */
export interface ParseTolerances {
  narrationSkipped: number
  emptyChunksSkipped: number
}

/** A section parser consumes lines from `index` and reports where it stopped. */
export interface SectionResult {
  hunk: PatchHunk
  next: number
}
