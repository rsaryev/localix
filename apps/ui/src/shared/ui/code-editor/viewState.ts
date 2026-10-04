/** Lightweight editor view state that remains stable across editor implementations. */
export interface ViewStateSnapshot {
  /** 1-based caret line. */
  line: number
  /** 0-based caret column. */
  column: number
  /** 1-based first visible line. */
  top: number
}

export interface ViewStateBridge {
  load: () => ViewStateSnapshot | null
  save: (snapshot: ViewStateSnapshot) => void
  skipRestore?: () => boolean
}
