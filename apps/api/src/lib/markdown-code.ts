/**
 * Where Markdown code sits on a line or in a document, for the `@`-reference scanners
 * (`agent-core/context-imports.ts`, `chat/service/file-references.ts`): a reference inside a
 * code span or a fenced block is shown literally rather than expanded.
 */

/** Byte-index ranges of inline code spans (`` `...` ``) on a single line. */
export function codeSpanRanges(line: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const re = /`+/g
  let open: { index: number; len: number } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    const len = m[0].length
    if (!open) open = { index: m.index, len }
    else if (open.len === len) {
      ranges.push([open.index, m.index + len])
      open = null
    }
  }
  return ranges
}

export function insideAnyRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => index >= s && index < e)
}

/**
 * Line-by-line fenced-block tracker. The returned function answers whether a line is a fence
 * line or inside a fenced block; a block closes only on the marker kind (```` ``` ```` or `~~~`)
 * that opened it.
 */
export function createFenceTracker(): (line: string) => boolean {
  let inFence = false
  let fenceMarker = ''
  return (line) => {
    const fence = line.match(/^\s*(```+|~~~+)/)
    if (fence) {
      const marker = fence[1]![0]!.repeat(3)
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (fenceMarker === marker) {
        inFence = false
      }
      return true
    }
    return inFence
  }
}
