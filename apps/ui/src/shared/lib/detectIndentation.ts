/**
 * Indentation summary for the editor status bar ("Spaces: 2" /
 * "Tab Size: 4"). Pure text scan — no editor/DOM dependency, so it's unit-tested.
 */
export interface IndentationInfo {
  /** `true` when the file indents with tabs, `false` for spaces. */
  usesTabs: boolean
  /** Space width (spaces mode) or displayed tab width (tabs mode). */
  size: number
}

const DEFAULT: IndentationInfo = { usesTabs: false, size: 2 }

/**
 * Infer a file's indentation from its leading whitespace, loosely: if more indented lines start with a tab than with spaces,
 * report tabs; otherwise pick the most common positive space-step between
 * consecutive indent levels (falling back to the smallest non-zero indent).
 */
export function detectIndentation(text: string): IndentationInfo {
  if (!text) return DEFAULT
  const lines = text.split('\n')
  let tabLines = 0
  let spaceLines = 0
  // Histogram of space-indent widths → vote on the base step.
  const widthVotes = new Map<number, number>()
  let prevSpaces = 0

  for (const line of lines) {
    if (line.length === 0) continue
    const ch = line[0]
    if (ch === '\t') {
      tabLines++
      prevSpaces = 0
      continue
    }
    if (ch !== ' ') {
      prevSpaces = 0
      continue
    }
    let spaces = 0
    while (spaces < line.length && line[spaces] === ' ') spaces++
    // Ignore lines that are all whitespace (no content after the indent).
    if (spaces === line.length) continue
    spaceLines++
    // Vote for the step vs the previous indented line, else the absolute indent.
    const step = prevSpaces > 0 && spaces > prevSpaces ? spaces - prevSpaces : spaces
    if (step > 0) widthVotes.set(step, (widthVotes.get(step) ?? 0) + 1)
    prevSpaces = spaces
  }

  if (tabLines > spaceLines) return { usesTabs: true, size: 4 }
  if (widthVotes.size === 0) return DEFAULT

  let bestWidth = 0
  let bestVotes = -1
  for (const [width, votes] of widthVotes) {
    // Prefer more votes; tie-break toward the smaller step.
    if (votes > bestVotes || (votes === bestVotes && width < bestWidth)) {
      bestVotes = votes
      bestWidth = width
    }
  }
  return { usesTabs: false, size: bestWidth || DEFAULT.size }
}
