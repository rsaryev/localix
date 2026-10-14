export interface StickySymbol {
  name: string
  /** 0-based header line. */
  line: number
  /** 0-based inclusive end line. */
  endLine: number
  depth: number
}

const MAX_STICKY_LINES = 5

export function computeStickyChain(
  symbols: readonly StickySymbol[],
  topLine: number,
): StickySymbol[] {
  const chain = symbols
    .filter(
      (symbol) => symbol.line < topLine && symbol.endLine > topLine && symbol.endLine > symbol.line,
    )
    .sort((left, right) => left.line - right.line || left.depth - right.depth)
  return chain.length > MAX_STICKY_LINES ? chain.slice(chain.length - MAX_STICKY_LINES) : chain
}
