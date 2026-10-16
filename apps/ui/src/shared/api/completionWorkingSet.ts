/**
 * The working set every completion request carries: what the user has open and visible right now.
 *
 * Every inline-completion surface — the chat composer, a commit subject, a plugin's field, the
 * code editor — gets it from HERE, so a new surface has open-tab context without writing a line
 * of it. It used to exist only for the chat composer (its ambient chips), which is why the code
 * editor predicted edits blind to the file open beside it.
 *
 * `shared/api` cannot know the workspace grid (FSD), so the grid registers the one provider at
 * startup (`app/main.tsx`), the same shape as the agent-run preflight.
 */
import {
  COMPLETION_INLINE_CONTENT_MAX,
  COMPLETION_REFERENCE_LIMIT,
} from '@localixai/api/inline-completion-contracts'
import type { CompletionReference } from '@localixai/api/client'

export interface CompletionWorkingSetOptions {
  /** The requesting editor's own document, already in its prompt whole. */
  excludeFilePath?: string
}

export type CompletionWorkingSetProvider = (
  options?: CompletionWorkingSetOptions,
) => readonly CompletionReference[]

let provider: CompletionWorkingSetProvider | null = null

/** Install the provider; returns the uninstall function. */
export function registerCompletionWorkingSet(next: CompletionWorkingSetProvider): () => void {
  provider = next
  return () => {
    if (provider === next) provider = null
  }
}

const MAX_ATTRIBUTES = 16

/**
 * Fit a reference to the socket's bounds. The server rejects an over-long attribute as a
 * malformed request — the WHOLE completion, every surface in it — so a snippet's content is
 * clipped here rather than trusted to be short.
 */
export function boundCompletionReference(reference: CompletionReference): CompletionReference {
  if (!reference.attributes) return reference
  const attributes = Object.fromEntries(
    Object.entries(reference.attributes)
      .slice(0, MAX_ATTRIBUTES)
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value.slice(0, COMPLETION_INLINE_CONTENT_MAX) : value,
      ]),
  )
  return { ...reference, attributes }
}

/**
 * The current working set, bounded, minus whatever the caller already carries (the editor passes
 * its own document). Never throws: a broken provider means no working set, not no completion.
 */
export function completionWorkingSet(
  options: CompletionWorkingSetOptions = {},
): CompletionReference[] {
  let references: readonly CompletionReference[] = []
  try {
    references = provider?.(options) ?? []
  } catch {
    references = []
  }
  return references
    .slice(0, COMPLETION_REFERENCE_LIMIT)
    .map((reference) => boundCompletionReference({ ...reference, origin: 'ambient' }))
}
