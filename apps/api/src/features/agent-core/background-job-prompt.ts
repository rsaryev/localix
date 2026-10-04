/** Keep live-process metadata useful without letting it become a second transcript. */
export const BACKGROUND_JOB_PROMPT_MAX_ITEMS = 16
export const BACKGROUND_JOB_COMMAND_MAX_CHARS = 400
export const BACKGROUND_JOB_OUTPUT_MAX_CHARS = 1_500

const neutralizeDelimiter = (char: string): string => {
  switch (char) {
    case '<':
      return '‹'
    case '>':
      return '›'
    case '&':
      return '＆'
    case '`':
      return 'ˋ'
    default:
      return char
  }
}

/** Single-line command/id rendering safe inside Markdown prompt prose. */
export function compactBackgroundJobValue(value: string, maxChars: number): string {
  const clean = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[<>&`]/g, neutralizeDelimiter)
  return clean.length <= maxChars ? clean : `${clean.slice(0, Math.max(0, maxChars - 1))}…`
}

/**
 * Quote the newest output tail as visibly untrusted data. Every line receives a
 * non-Markdown prefix, and prompt/XML/Markdown delimiters are neutralized without
 * expansion so an output line cannot close the wrapper or start a new heading/fence.
 */
export function quoteBackgroundJobOutput(output: string): string {
  const tail =
    output.length <= BACKGROUND_JOB_OUTPUT_MAX_CHARS
      ? output
      : `…${output.slice(-(BACKGROUND_JOB_OUTPUT_MAX_CHARS - 1))}`
  return tail
    .split('\0')
    .join('�')
    .replace(/[<>&`]/g, neutralizeDelimiter)
    .split('\n')
    .map((line) => `│ ${line}`)
    .join('\n')
}
