import { formatEditEvents } from './predict-next-edit-context'
import type { AutomaticContextProvider, ContextContribution } from '@localixai/mini-app-sdk/backend'

/**
 * Host-owned automatic Context Fabric adapter for Edit Prediction's existing,
 * validated request envelope. It intentionally has no filesystem, plugin, URI-scheme
 * or client-runtime dependency: the task host supplies the active document and its
 * same-document edit events, and the generic manager applies policy and budgets.
 *
 * The active-document contribution is a revisioned descriptor rather than a second
 * copy of the document body. The prediction recipe already owns the numbered current
 * file as its required task input; duplicating it through Fabric would waste budget.
 */
export const EDIT_PREDICTION_CONTEXT_PROVIDER_ID = 'edit-prediction-host'

export type EditPredictionHistoryEvent = {
  before?: string[]
  lines: string[]
  startLine?: number
  endLine?: number
}

export function createEditPredictionContextProvider(): AutomaticContextProvider {
  return {
    id: EDIT_PREDICTION_CONTEXT_PROVIDER_ID,
    version: '1',
    destinations: ['edit-prediction'],
    sensitivity: 'project',
    async provide(req, signal) {
      if (signal.aborted || !req.document) return []
      const document = req.document
      const contributions: ContextContribution[] = [
        {
          id: `active-document:${document.uri}`,
          providerId: EDIT_PREDICTION_CONTEXT_PROVIDER_ID,
          providerVersion: '1',
          scope: 'document',
          kind: 'active-document',
          content: `Active document: ${document.uri}\nLanguage: ${document.languageId}\nRevision: ${document.revision || 'unknown'}`,
          uri: document.uri,
          revision: document.revision || undefined,
          priority: 1_000,
          sensitivity: 'project',
        },
      ]
      const history = formatEditEvents((req.editHistory ?? []) as EditPredictionHistoryEvent[])
      if (history)
        contributions.push({
          id: `edit-history:${document.uri}:${document.revision || 'current'}`,
          providerId: EDIT_PREDICTION_CONTEXT_PROVIDER_ID,
          providerVersion: '1',
          scope: 'session',
          kind: 'edit-history',
          content: history,
          uri: `${document.uri}#edit-history`,
          revision: document.revision || undefined,
          priority: 900,
          sensitivity: 'project',
          relevanceHints: { recency: 1 },
        })
      return contributions
    },
  }
}
