export interface StickySymbol {
  name: string
  /** 0-based header line. */
  line: number
  /** 0-based inclusive end line. */
  endLine: number
  depth: number
}
