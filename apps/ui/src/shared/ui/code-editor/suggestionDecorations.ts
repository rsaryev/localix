/** Fail-closed anchor check for native Monaco inline edits. */
export function isSuggestionDrifted(
  documentLines: string[],
  suggestion: { startLine: number; endLine: number; original: string },
): boolean {
  if (documentLines.length === 0) return suggestion.original !== ''
  if (
    !Number.isInteger(suggestion.startLine) ||
    !Number.isInteger(suggestion.endLine) ||
    suggestion.startLine < 1 ||
    suggestion.endLine < suggestion.startLine ||
    suggestion.endLine > documentLines.length
  ) {
    return true
  }
  return (
    documentLines.slice(suggestion.startLine - 1, suggestion.endLine).join('\n') !==
    suggestion.original
  )
}
