/**
 * What a console hands the chat on its own, with no drag: the draft on screen, the result the
 * reader is looking at, and the tail of the Output log (every run's outcome, errors included).
 *
 * The defect this replaces: only the unsent draft was published. The rows a question is ABOUT and
 * the error a run just raised reached the agent only if the user dragged a "Drag to chat" grip onto
 * the composer — so "why did this fail?" arrived without the failure. Every console (SQL, Mongo,
 * Redis, Elasticsearch) runs through the same result-tab model, so one builder serves all four.
 *
 * Bounded by construction: the result snippet caps its rows (`MAX_SNIPPET_ROWS`), the Output facet
 * carries only its last entries, and the host clips each snippet again at `LIVE_SNIPPET_CONTENT_MAX`.
 */
import { formatOutputLogText, type ResultTab } from './resultTabs'
import { tabToSnippet } from './resultSnippet'

/** Output entries carried — the recent runs a follow-up question refers to, not the session. */
export const OUTPUT_CONTEXT_TAIL = 12

export interface ConsoleContextFacet {
  label: string
  content: string
  language: string
}

export function draftFacet(draft: ConsoleContextFacet): ConsoleContextFacet | null {
  return draft.content.trim() ? draft : null
}

/** The active result tab, if the reader is looking at one (the Output tab has its own facet). */
export function activeResultFacet(
  tabs: readonly ResultTab[],
  activeTabId: string | null,
  connectionLabel?: string,
): ConsoleContextFacet | null {
  const tab = tabs.find((candidate) => candidate.id === activeTabId)
  if (tab?.kind !== 'result') return null
  const snippet = tabToSnippet(tab, connectionLabel)
  return snippet ? { ...snippet, language: 'text' } : null
}

export function outputFacet(
  tabs: readonly ResultTab[],
  connectionLabel?: string,
): ConsoleContextFacet | null {
  const log = tabs.find((tab) => tab.kind === 'output')?.log ?? []
  if (log.length === 0) return null
  const tail = log.slice(-OUTPUT_CONTEXT_TAIL)
  const note = tail.length < log.length ? `(last ${tail.length} of ${log.length} entries)\n\n` : ''
  return {
    label: `Output — ${connectionLabel ?? 'console'}`,
    content: `${note}${formatOutputLogText(tail)}`,
    language: 'text',
  }
}
