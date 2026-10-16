import { isEscaped, markdownProseWithoutCode } from './markdown-prose'

/** Detect remark-math delimiters without loading KaTeX for shell vars or code blocks. */
export function hasMathSyntax(markdown: string): boolean {
  const text = markdownProseWithoutCode(markdown)

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '$' || isEscaped(text, index)) continue
    const delimiterLength = text[index + 1] === '$' ? 2 : 1

    if (
      delimiterLength === 1 &&
      (text[index - 1] === '$' || text[index + 1] === '$' || !text[index + 1])
    ) {
      continue
    }

    for (let closing = index + delimiterLength; closing < text.length; closing += 1) {
      if (
        text[closing] !== '$' ||
        isEscaped(text, closing) ||
        (delimiterLength === 2 && text[closing + 1] !== '$') ||
        (delimiterLength === 1 && (text[closing - 1] === '$' || text[closing + 1] === '$'))
      ) {
        continue
      }

      const body = text.slice(index + delimiterLength, closing)
      const trimmedBody = body.trim()
      if (!trimmedBody) break
      // remark-math does not treat a single-dollar span across a blank
      // paragraph as one inline expression.
      if (delimiterLength === 1 && /\n[ \t]*\n/u.test(body)) {
        index = closing
        break
      }
      // `$5–$10` and similar currency ranges are prose, not an equation.
      if (
        delimiterLength === 1 &&
        /^\d/.test(trimmedBody) &&
        /\d/.test(text[closing + delimiterLength] ?? '')
      ) {
        index = closing
        break
      }
      // Adjacent shell variables such as `$HOME/$PATH` contain two dollar
      // signs, but the text between them is not a math expression.
      if (
        delimiterLength === 1 &&
        /^[A-Z_][A-Z0-9_]*[/:.-]$/u.test(trimmedBody) &&
        /^[A-Za-z_][A-Za-z0-9_]*/u.test(text.slice(closing + 1))
      ) {
        index = closing
        break
      }
      return true
    }
  }

  return false
}

/** Raw HTML only matters in prose. Tags shown inside fenced/indented/inline code
 * stay literal, so they must not enable the full rehype-raw + sanitize pipeline. */
export function hasHtmlSyntax(markdown: string): boolean {
  return /<[a-zA-Z][\w-]*[\s/>]/.test(markdownProseWithoutCode(markdown))
}
