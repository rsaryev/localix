import { useCallback } from 'react'
import type { NextEditRequest, NextEditSource, EditorSuggestion } from '@localixai/kit/code-editor'
import { miniAppEditor } from '@localixai/mini-app-sdk/ui/runtime'
import { useMiniAppEditPredictionEnabled } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import type { MiniAppCompletionReference } from '@localixai/mini-app-sdk/ui'

/**
 * AI edit prediction for the SQL console — the SAME unified edit-prediction
 * pipeline the code editor uses, fed the query as a synthetic `query.sql`
 * document. Gated by the canonical `inlineCompletion` model route and resolved
 * through that route's provider/model/reasoning tuple. Returns undefined (→ no
 * requests) when disabled or when the console belongs to no chat.
 *
 * The prediction runs for the console's OWN chat (its tab's session). It used to run for the
 * active one, so a console kept open in chat A predicted with chat B's route and context
 * whenever B was on screen.
 *
 * `getContextReferences` identifies the active connection and focused tables. The
 * server resolves them through the mini app's Context Fabric provider, so this UI
 * never sends schema text, provider provenance, or sensitivity labels directly.
 */
export function useSqlNextEdit(
  getContextReferences?: (request: NextEditRequest) => MiniAppCompletionReference[],
): NextEditSource | undefined {
  const enabled = useMiniAppEditPredictionEnabled()
  const sessionId = useWorkItemSessionId()

  const source = useCallback(
    async (req: NextEditRequest, signal: AbortSignal): Promise<EditorSuggestion[] | null> => {
      if (!sessionId) return null
      // Nothing useful to predict on a blank buffer.
      if (!req.content.trim()) return null
      const result = await miniAppEditor.predictNextEdit(
        sessionId,
        {
          file: 'query.sql',
          content: req.content,
          cursorLine: req.cursorLine,
          cursorColumn: req.cursorColumn,
          requestId: req.requestId,
          documentVersion: req.documentVersion,
          documentDigest: req.documentDigest,
          language: 'sql',
          recentlyEditedRanges: [],
          contextReferences: getContextReferences?.(req) ?? [],
        },
        signal,
      )
      if (signal.aborted) throw new DOMException('Cancelled prediction', 'AbortError')
      if (result.outcome !== 'predicted') {
        if (
          result.outcome === 'empty' &&
          (!result.diagnostic ||
            (result.diagnostic.code === 'empty' && result.diagnostic.outcome === 'empty'))
        )
          return null
        throw new Error(
          result.diagnostic?.code === 'empty' ? result.diagnostic.outcome : 'stale_delivery',
        )
      }
      return result.edits.map((edit, i) => ({
        id: `next-edit:${i}`,
        kind: 'suggestion' as const,
        source: 'edit-prediction' as const,
        startLine: edit.startLine,
        endLine: edit.endLine,
        original: edit.original,
        replacement: edit.replacement,
      }))
    },
    [getContextReferences, sessionId],
  )

  return enabled && sessionId ? source : undefined
}
