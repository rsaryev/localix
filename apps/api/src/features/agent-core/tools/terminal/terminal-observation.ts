/** Automatic observations keep a complete snapshot in details, but bound the model-facing text. */
export const SCREEN_OBSERVATION_CHARS = 2_000

/** Cut at UTF-16 boundaries without splitting an emoji into lone surrogates. */
function slice(text: string, start: number, end: number): string {
  const isLow = (index: number) => {
    const code = text.charCodeAt(index)
    return code >= 0xdc00 && code <= 0xdfff
  }
  return text.slice(isLow(start) ? start + 1 : start, isLow(end) ? end - 1 : end)
}

export function compactScreenText(text: string, waitFor?: string): string {
  if (text.length <= SCREEN_OBSERVATION_CHARS) return text
  const headEnd = 500
  const tailStart = text.length - 1_000
  const matchAt = waitFor ? text.lastIndexOf(waitFor) : -1
  // Keep evidence of a matched condition even when it lives in the omitted middle.
  const keepMatch =
    waitFor &&
    waitFor.length <= 500 &&
    matchAt >= 0 &&
    matchAt + waitFor.length > headEnd &&
    matchAt < text.length - 1_500
  const marker = '\n[… viewport clipped; use action="screen" for the full viewport …]\n'
  if (keepMatch) {
    const start = Math.max(0, matchAt - Math.floor((500 - waitFor.length) / 2))
    return (
      slice(text, 0, headEnd) +
      marker +
      slice(text, start, start + 500) +
      marker +
      slice(text, tailStart, text.length)
    )
  }
  return slice(text, 0, headEnd) + marker + slice(text, text.length - 1_500, text.length)
}
