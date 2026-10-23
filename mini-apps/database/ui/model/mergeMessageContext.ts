import {
  PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS,
  snippetMessageBindingDraft,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'
import type { ConsoleContextFacet } from './consoleContext'

/**
 * One tab has ONE publication slot, and a `.sql` file tab has two authors: the host's file view
 * (selection / unsaved buffer) and the runner around it (result, Output). Two writers to one slot
 * would erase each other on every change, so the runner takes the file view's publication as an
 * input and publishes the union.
 *
 * The file view's strategy is kept: `replace` means "this, not the saved file" (a selection, a
 * dirty buffer); no publication means the static file binding stands, so the runner's facets are
 * APPENDED beside it.
 */
export function mergeMessageContext(
  own: PublishedMessageContext | null,
  facets: readonly ConsoleContextFacet[],
): PublishedMessageContext | null {
  const extra = facets.map((facet) =>
    snippetMessageBindingDraft({
      label: facet.label,
      content: facet.content,
      language: facet.language,
    }),
  )
  if (!own) return extra.length > 0 ? { strategy: 'append', bindings: extra } : null
  if (extra.length === 0) return own
  return {
    strategy: own.strategy,
    // The file view's own bindings first: they are what the tab IS.
    bindings: [...own.bindings, ...extra].slice(0, PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS),
  }
}
