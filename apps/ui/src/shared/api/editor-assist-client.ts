/**
 * Auxiliary-model transports for shared text-input completion, editor edit
 * prediction. Completion and edit prediction share one drawer
 * route; every call is fail-safe.
 *
 * One of the `backendClient` domain modules spread into the facade in
 * `./client`, so `backendClient.predictNextEdit(...)` keeps working unchanged.
 */

import type {
  CompletionReference,
  EditPrediction,
  InlineCompletionResult,
  InlineCompletionResponse,
} from '@localixai/api/client'
import { eventSocket } from './eventSocket'
import { recordInlineAssistMetric } from '@/shared/lib/inlineAssistMetrics'

/** Metadata-only reason why an edit-prediction response was not deliverable. */
export type NextEditPredictionDiagnostic =
  | {
      code: 'stale_delivery'
      mismatch: 'protocol' | 'request_id' | 'document_version' | 'document_digest'
    }
  | {
      code: 'empty'
      outcome: 'empty' | 'cancelled' | 'deadline_exceeded' | 'no_model' | 'provider_error'
    }

/** Client-facing edit-prediction delivery outcome. Diagnostics deliberately contain
 * no document text, paths, identifiers, or digest values. */
export type NextEditPredictionResult =
  | { outcome: 'predicted'; edits: EditPrediction[]; diagnostic?: undefined }
  | { outcome: 'empty' | 'stale_delivery'; edits: null; diagnostic: NextEditPredictionDiagnostic }

type NextEditPredictionResponse = {
  protocolVersion: 2
  requestId?: string
  documentVersion?: number
  documentDigest?: string
  outcome: 'predicted' | 'empty' | 'cancelled' | 'deadline_exceeded' | 'no_model' | 'provider_error'
  edits: EditPrediction[] | null
} | null

type NextEditPredictionCorrelation = {
  requestId: string
  documentVersion: number
  documentDigest: string
}

/**
 * Validates the reply echo before it can reach an editor. Every response must
 * echo the request/version/digest fields; absent or
 * mismatched correlation is an explicit stale delivery, never a prediction.
 */
export function resolveNextEditPredictionResponse(
  request: NextEditPredictionCorrelation,
  response: NextEditPredictionResponse,
): NextEditPredictionResult {
  if (response?.protocolVersion !== 2) {
    return {
      outcome: 'stale_delivery',
      edits: null,
      diagnostic: { code: 'stale_delivery', mismatch: 'protocol' },
    }
  }
  if (response.requestId !== request.requestId) {
    return {
      outcome: 'stale_delivery',
      edits: null,
      diagnostic: { code: 'stale_delivery', mismatch: 'request_id' },
    }
  }
  if (response.documentVersion !== request.documentVersion) {
    return {
      outcome: 'stale_delivery',
      edits: null,
      diagnostic: { code: 'stale_delivery', mismatch: 'document_version' },
    }
  }
  if (response.documentDigest !== request.documentDigest) {
    return {
      outcome: 'stale_delivery',
      edits: null,
      diagnostic: { code: 'stale_delivery', mismatch: 'document_digest' },
    }
  }
  if (response?.edits && response.edits.length > 0)
    return { outcome: 'predicted', edits: response.edits }
  return {
    outcome: 'empty',
    edits: null,
    diagnostic: {
      code: 'empty',
      outcome: response?.outcome === 'predicted' ? 'empty' : (response?.outcome ?? 'empty'),
    },
  }
}

export const editorAssistApi = {
  /** Unified text-input completion — ONE aux call answering every requested
   *  chat/commit surface at once. Returns
   *  a per-surface map; a surface with nothing usable is simply absent. Callers
   *  go through the shared inline-completion hub (offer gathering + cache + dedupe)
   *  rather than calling this directly. */
  async completeInputs(
    sessionId: string,
    surfaces: Record<string, unknown>,
    signal?: AbortSignal,
    references: readonly CompletionReference[] = [],
  ): Promise<InlineCompletionResult> {
    const res = await eventSocket.request<InlineCompletionResponse | null>(
      {
        t: 'inline.complete',
        sessionId,
        surfaces,
        ...(references.length > 0 ? { references } : {}),
      },
      { signal },
    )
    if (!res) throw new Error('Inline completion unavailable')
    recordInlineAssistMetric('input', res.outcome ?? 'empty', res.durationMs)
    if (res.outcome && !['suggested', 'empty'].includes(res.outcome)) {
      throw Object.assign(new Error(res.outcome), { code: res.outcome })
    }
    return res.completions
  },

  /** Edit prediction — propose the most-likely NEXT edit(s) as a
   *  small same-file diff (up to a few hunks), or null. Fail-safe:
   *  any parse/confidence failure resolves null. `contextReferences` are opaque
   *  user selections; the server resolves and policies their content. */
  async predictNextEdit(
    sessionId: string,
    payload: {
      file: string
      content: string
      cursorLine: number
      cursorColumn?: number
      requestId: string
      documentVersion: number
      documentDigest: string
      contextFingerprint?: string
      language: string
      recentlyEditedRanges: {
        before?: string[]
        lines: string[]
        startLine?: number
        endLine?: number
      }[]
      /** The editor's anchors plus the shared working set — the shape every surface sends. */
      contextReferences?: CompletionReference[]
    },
    signal?: AbortSignal,
  ): Promise<NextEditPredictionResult> {
    const startedAt = performance.now()
    const res = await eventSocket.request<NextEditPredictionResponse>(
      { t: 'predictNextEdit', sessionId, ...payload },
      { signal },
    )
    const result = resolveNextEditPredictionResponse(payload, res)
    recordInlineAssistMetric(
      'editor',
      result.diagnostic?.code === 'empty' ? result.diagnostic.outcome : result.outcome,
      performance.now() - startedAt,
    )
    return result
  },
}
