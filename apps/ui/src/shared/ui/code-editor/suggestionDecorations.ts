import type { EditorSuggestion } from './types'

export interface SuggestionHandlers {
  onApply: (id: string) => void | Promise<unknown>
  onReject: (id: string) => void | Promise<unknown>
  onResolve?: (id: string) => void | Promise<unknown>
}

export interface SuggestionPresentation {
  label: string
  isAi: boolean
  ariaLabel: string
}

export function suggestionPresentation(
  suggestion: Pick<EditorSuggestion, 'kind' | 'source'>,
): SuggestionPresentation {
  const source = suggestion.source ?? 'review'
  if (source === 'edit-prediction') {
    return {
      label: 'Edit prediction',
      isAi: true,
      ariaLabel: 'AI edit prediction — proposed change. Press Tab to apply, Escape to dismiss.',
    }
  }
  const label = suggestion.kind === 'suggestion' ? 'Review suggestion' : 'Review comment'
  return { label, isAi: false, ariaLabel: label }
}

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
