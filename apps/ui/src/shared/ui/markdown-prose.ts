/**
 * Which characters of a markdown source are prose — the text outside fenced, indented and inline
 * code — as one mask the math sniffer, the HTML sniffer and the literal-dollar escaper all read.
 *
 * The mask keeps the source's exact length and line breaks: code characters become spaces, so an
 * index into the mask is an index into the source. The escaper depends on that — it inserts a
 * backslash at a position found in the mask — and a mask that dropped code lines (as the first
 * version here did) would shift every position after the first code block.
 */
export function markdownProseWithoutCode(markdown: string): string {
  const prose: string[] = []
  let fence: { character: string; length: number } | null = null
  const blank = (line: string) => ' '.repeat(line.length)

  for (const line of markdown.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length &&
        line.slice(marker[0].length).trim() === ''
      ) {
        fence = null
      }
      prose.push(blank(line))
      continue
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length }
      prose.push(blank(line))
      continue
    }

    // Four-space/tab-indented CommonMark code is as inert as a fenced block.
    prose.push(/^(?: {4}|\t)/.test(line) ? blank(line) : line)
  }

  // Inline code spans may cross line breaks. Blank only complete spans; an
  // unmatched backtick stays prose, matching CommonMark's literal treatment.
  const source = prose.join('\n')
  const visible = source.split('')
  for (let index = 0; index < visible.length;) {
    if (source[index] !== '`' || isEscaped(source, index)) {
      index += 1
      continue
    }
    let delimiterLength = 1
    while (source[index + delimiterLength] === '`') delimiterLength += 1
    let closing = index + delimiterLength
    while (closing < visible.length) {
      if (source[closing] !== '`' || isEscaped(source, closing)) {
        closing += 1
        continue
      }
      let closingLength = 1
      while (source[closing + closingLength] === '`') closingLength += 1
      if (closingLength === delimiterLength) break
      closing += closingLength
    }
    if (closing >= visible.length) {
      index += delimiterLength
      continue
    }
    const end = closing + delimiterLength
    for (let cursor = index; cursor < end; cursor += 1) {
      if (visible[cursor] !== '\n') visible[cursor] = ' '
    }
    index = end
  }
  return visible.join('')
}

/** Whether the character at `index` is backslash-escaped (an odd run of `\` before it). */
export function isEscaped(text: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}
