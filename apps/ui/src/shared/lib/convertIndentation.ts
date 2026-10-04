/**
 * Convert a file's leading indentation between tabs and spaces. Pure text
 * transform — operates only on the leading whitespace of each line, leaving the
 * rest of the line untouched — so it is unit-tested without an editor/DOM.
 */

/** The indentation unit a conversion targets. */
export type IndentationTarget = 'spaces' | 'tabs'

const LEADING_WHITESPACE = /^[ \t]+/

/**
 * Rewrite the leading whitespace of every line so it uses `target`, treating
 * `tabWidth` as the display width of one tab. The rule is simple:
 * tabs→spaces expands each tab to `tabWidth` spaces; spaces→tabs collapses each
 * run of exactly `tabWidth` spaces into one tab (leftover spaces are preserved).
 */
export function convertIndentation(
  text: string,
  tabWidth: number,
  target: IndentationTarget,
): string {
  const width = Math.max(1, Math.floor(tabWidth))
  const spaces = ' '.repeat(width)
  const spacesRun = new RegExp(spaces, 'g')

  return text
    .split('\n')
    .map((line) => {
      const match = LEADING_WHITESPACE.exec(line)
      if (!match) return line
      const prefix = match[0]
      const rest = line.slice(prefix.length)
      const newPrefix =
        target === 'spaces' ? prefix.replace(/\t/g, spaces) : prefix.replace(spacesRun, '\t')
      return newPrefix + rest
    })
    .join('\n')
}
