/**
 * Edit-prediction ENGINE — orchestration only. It composes the split modules into
 * one `predict()`/`predictDetailed()` flow: host deadline + cancellation, aux-model
 * resolution, Context Fabric collection/explicit-resolution, canonical prompt rendering,
 * the capability-negotiating model adapter, strict finish-reason
 * handling, structured parsing, and metadata-only telemetry.
 *
 * The implementation and its typed outcomes live here; UI transports only adapt
 * requests and responses around this engine.
 *
 * SAME-FILE ONLY. FAIL-SAFE: a truncated generation, a malformed reply, or an empty
 * survivor set resolves to a neutral outcome, never a partial/broken edit.
 */

import { resolveAuxLanguageModel } from '../autocomplete/resolve-model'
import { COMPLETION_RAW_CONTEXT_BYTES } from '../autocomplete/completion-context'
import {
  mergeCompletionReferences,
  resolveCompletionReferences,
} from '../autocomplete/completion-references'
import type { ContextCollectionResult, ContextDropReason } from '../context-fabric/manager'
import {
  MAX_TOKENS,
  NEXT_EDIT_DEADLINE_MS,
  type EditPrediction,
  type NextEditOutcome,
  type NextEditResult,
  type NextEditServiceDeps,
  type PredictNextEditRequest,
} from './contracts'
import { createLanguageModelAdapter } from './model/adapter'
import { EDIT_PREDICTION_PROMPT } from './prompt/registry'
import { parseNextEditReplyDetailed } from './parse'
import { dropReversingEdits } from './reversal'
import { buildResultCacheKey, editHistoryDigest, sha256Hex } from './cache/keys'

/** Fold Context Fabric collection results into aggregate, content-free diagnostics. */
function contextTelemetry(
  ...results: Array<ContextCollectionResult | undefined>
): NextEditOutcome['context'] | undefined {
  const present = results.filter((result): result is ContextCollectionResult => Boolean(result))
  if (present.length === 0) return undefined
  const droppedByReason: NonNullable<NextEditOutcome['context']>['droppedByReason'] = {}
  const outcomesByStatus: NonNullable<NextEditOutcome['context']>['outcomesByStatus'] = {}
  let providerCount = 0
  let contributionCount = 0
  for (const result of present) {
    providerCount += result.providerOutcomes.length
    contributionCount += result.contributions.length
    for (const [reason, count] of Object.entries(result.diagnostics.droppedByReason) as Array<
      [ContextDropReason, number]
    >)
      droppedByReason[reason] = (droppedByReason[reason] ?? 0) + count
    for (const { status } of result.providerOutcomes)
      outcomesByStatus[status] = (outcomesByStatus[status] ?? 0) + 1
  }
  return { providerCount, contributionCount, droppedByReason, outcomesByStatus }
}

export function createEditPredictionEngine(deps: NextEditServiceDeps) {
  const makeAdapter = deps.createModelAdapter ?? createLanguageModelAdapter

  function recordOutcome(event: NextEditOutcome): void {
    try {
      deps.recordOutcome?.(event)
    } catch {
      /* telemetry must not affect prediction */
    }
  }

  /** Predict the next same-file edit hunks, or a typed neutral outcome. */
  async function predictDetailed(
    userId: string,
    req: PredictNextEditRequest,
    signal?: AbortSignal,
  ): Promise<NextEditResult> {
    const startedAt = Date.now()
    const deadlineAtMs = startedAt + (deps.deadlineMs ?? NEXT_EDIT_DEADLINE_MS)
    const controller = new AbortController()
    let deadlineExceeded = false
    const abortFromCaller = () => controller.abort()
    // A signal already aborted on entry never re-fires 'abort', so wire it through
    // up front — otherwise the guard below would miss it and we'd spend a full aux
    // call on a request the caller already cancelled.
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', abortFromCaller, { once: true })
    const deadlineTimer = setTimeout(
      () => {
        deadlineExceeded = true
        controller.abort()
      },
      Math.max(0, deadlineAtMs - Date.now()),
    )
    const operationSignal = controller.signal
    /**
     * Hunks the reversal guard dropped, set only by a run that actually parsed a reply.
     * A cache hit leaves it undefined: reporting 0 there would understate the guard.
     */
    let reversedEditCount: number | undefined
    /** Per-cause parse rejections, set only by a run that actually parsed a reply. */
    let editRejections: NextEditOutcome['editRejections']
    /** Hunks that echoed prompt scaffolding back and had it stripped. Same rule: only a run
     * that parsed a reply can know, so a cache hit leaves it undefined rather than 0. */
    let scaffoldEchoes: number | undefined
    const finish = (
      outcome: NextEditOutcome['outcome'],
      edits: EditPrediction[] | null = null,
      context?: NextEditOutcome['context'],
    ): NextEditResult => {
      recordOutcome({
        userId,
        sessionId: req.sessionId,
        outcome,
        durationMs: Date.now() - startedAt,
        contextReferenceCount: req.contextReferences?.length ?? 0,
        editCount: edits?.length ?? 0,
        ...(reversedEditCount !== undefined ? { reversedEditCount } : {}),
        ...(editRejections ? { editRejections } : {}),
        ...(scaffoldEchoes ? { scaffoldEchoes } : {}),
        context,
      })
      return { outcome, edits }
    }
    const abortedOutcome = () =>
      deadlineExceeded ? ('deadline_exceeded' as const) : ('cancelled' as const)
    try {
      if (operationSignal.aborted) return finish(abortedOutcome())
      if (!req.content.trim()) return finish('empty')

      const resolved = await resolveAuxLanguageModel(
        deps,
        userId,
        req.sessionId,
        'inlineCompletion',
      )
      if (!resolved) return finish('no_model')
      if (operationSignal.aborted) return finish(abortedOutcome())
      const { model, modelId, providerConnectionId, providerId, reasoningEffort } = resolved
      const adapter = makeAdapter(model, modelId)
      const capabilities = adapter.capabilities()
      const workspace =
        deps.contextManager && deps.resolveContextWorkspace
          ? await deps.resolveContextWorkspace(userId, req.sessionId).catch(() => undefined)
          : undefined
      if (operationSignal.aborted) return finish(abortedOutcome())

      const contextPromise = deps.contextManager
        ? deps.contextManager.collect(
            {
              destination: 'edit-prediction',
              userId,
              sessionId: req.sessionId,
              // Raw material, not the prompt budget: `packCompletionContext` excerpts from it.
              maxBytes: COMPLETION_RAW_CONTEXT_BYTES,
              document: {
                uri: req.filepath,
                languageId: req.language,
                revision: req.documentDigest ?? '',
                content: req.content,
              },
              editHistory: req.recentlyEditedRanges,
              cursor: { line: req.cursorLine - 1, character: req.cursorColumn ?? 0 },
              deadlineAtMs,
              workspace,
            },
            [],
            operationSignal,
          )
        : undefined
      const explicitPromise = deps.contextManager
        ? resolveCompletionReferences(
            deps.contextManager,
            {
              destination: 'edit-prediction',
              userId,
              sessionId: req.sessionId,
              references: mergeCompletionReferences(req.contextReferences),
              ...(workspace ? { workspace } : {}),
              deadlineAtMs,
            },
            operationSignal,
          )
        : undefined
      const [context, explicit] = await Promise.all([contextPromise, explicitPromise])
      if (operationSignal.aborted) return finish(abortedOutcome())
      const prompt = EDIT_PREDICTION_PROMPT
      const { systemPrompt, userContent } = prompt.build(req, [
        ...(context?.contributions ?? []),
        ...(explicit?.contributions ?? []),
      ])
      const contextDiagnostics = contextTelemetry(context, explicit)

      /**
       * The billable model call + strict finish-reason handling + parse, isolated so
       * the L1 cache's single-flight can share ONE invocation across identical
       * concurrent fingerprints. `sig` is the shared/refcounted signal when cached,
       * else `operationSignal` directly. Always resolves to a neutral `NextEditResult`
       * — never throws — so the single-flight sees exactly one settled value.
       */
      const compute = async (sig: AbortSignal): Promise<NextEditResult> => {
        let text: string
        let truncated: boolean
        try {
          const response = await adapter.predict(
            {
              modelId,
              systemPrompt,
              userContent,
              budget: {
                outputTokens: Math.min(MAX_TOKENS, capabilities.maxOutputTokens ?? MAX_TOKENS),
              },
              temperature: 0.01,
              reasoningEffort: reasoningEffort ?? 'off',
              promptCaching: capabilities.promptCaching,
            },
            sig,
          )
          deps.recordUsage?.({
            userId,
            sessionId: req.sessionId,
            modelId,
            providerConnectionId,
            providerId,
            usage: response.usage,
          })
          text = response.text
          truncated = response.truncated
        } catch {
          return { outcome: sig.aborted ? abortedOutcome() : 'provider_error', edits: null }
        }
        if (sig.aborted) return { outcome: abortedOutcome(), edits: null }
        // Strict finish-reason handling (the silent-truncation defect class): a reply cut
        // off at the token budget may be a half-written edit — reject it rather than parse
        // and apply a partial hunk.
        if (truncated) return { outcome: 'provider_error', edits: null }
        const {
          edits: parsed,
          rejections,
          scaffoldEchoes: echoed,
        } = parseNextEditReplyDetailed(text, req.content)
        if (Object.keys(rejections).length > 0) editRejections = rejections
        if (echoed > 0) scaffoldEchoes = echoed
        // A hunk that restores the pre-edit text of a window the user just changed is
        // well-formed by every other measure — in range, anchored, non-overlapping — so
        // no existing gate stops it. Offering it asks the user to undo their own work.
        const edits = parsed ? dropReversingEdits(parsed, req.recentlyEditedRanges) : null
        // Count what the guard silenced. Only a computation can know this: on a cache hit
        // no reply is parsed, so the field stays absent rather than reporting a false 0.
        reversedEditCount = Math.max(0, (parsed?.length ?? 0) - (edits?.length ?? 0))
        return { outcome: edits ? 'predicted' : 'empty', edits }
      }

      let result: NextEditResult
      if (deps.resultCache) {
        const cacheKey = buildResultCacheKey({
          userId,
          projectRoot: workspace?.rootPath,
          isolationId: workspace?.isolationId,
          documentDigest: req.documentDigest ?? '',
          documentVersion: req.documentVersion,
          cursorLine: req.cursorLine,
          cursorColumn: req.cursorColumn,
          triggerClass: deps.triggerClass,
          editHistoryDigest: editHistoryDigest(req.recentlyEditedRanges),
          contextFingerprint: sha256Hex(userContent),
          modelId,
          providerConnectionId,
        })
        const hit = deps.resultCache.get(cacheKey)
        if (hit) return finish(hit.outcome, hit.edits, contextDiagnostics)
        result = await deps.resultCache.run(cacheKey, compute, operationSignal)
        // The single-flight reports a caller abort as neutral `cancelled`; reclassify to
        // the host's deadline taxonomy so a deadline still surfaces `deadline_exceeded`.
        if (operationSignal.aborted && result.outcome === 'cancelled') {
          result = { outcome: abortedOutcome(), edits: null }
        }
      } else {
        result = await compute(operationSignal)
      }
      return finish(result.outcome, result.edits, contextDiagnostics)
    } finally {
      clearTimeout(deadlineTimer)
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  /** Ergonomic local facade; RPC callers use `predictDetailed` to preserve the
   * reason for an empty response. */
  async function predict(
    userId: string,
    req: PredictNextEditRequest,
    signal?: AbortSignal,
  ): Promise<EditPrediction[] | null> {
    return (await predictDetailed(userId, req, signal)).edits
  }

  return { predict, predictDetailed }
}

export type NextEditService = ReturnType<typeof createEditPredictionEngine>
