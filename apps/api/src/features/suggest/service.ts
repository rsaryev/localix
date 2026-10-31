/**
 * Unified text-input completion service — ONE aux-LLM call that serves every
 * active ghost-text surface. Each surface resolves its rich domain context on
 * the server, then contributes one bounded prompt fragment. The model replies
 * with one labeled line per surface, so N active inputs cost one round-trip.
 *
 * Like inline code completion this is an AUXILIARY LLM call, not an agent tool —
 * no tool-pipeline wiring. Wired in `bootstrap.ts` and reached over the realtime
 * socket (`inline.complete` RPC). Spend records once per call under the
 * `'inline-completion'` usage
 * kind. The editor autocomplete (keystroke-level FIM) is deliberately NOT a
 * surface here — it is a different latency class with its own service.
 */

import { resolveAuxLanguageModel, type AuxLanguageModelDeps } from '../autocomplete/resolve-model'
import {
  SHARED_CONTEXT_BUDGET,
  buildInlineCompletionPrompt,
  declaredInputTokenBudget,
} from './prompt'
import { askCompletionModel, completionCache, completionFingerprint } from './model-call'

import { coreInlineCompletionSurface, type InlineCompletionSurfaceSpec } from './surfaces'
import { gatherSurfaceContext, type SurfaceContextDeps } from './surface-context'
import { startCompletionOperation } from './operation'
import type { SurfaceContextResolver } from './context-resolvers'
import { isModelRoutingTaskEnabled } from '../../contracts/model-task-catalog'
import type { Usage } from '@localixai/agent'
import type { MiniAppTextInputCompletionSurface } from '@localixai/mini-app-sdk/backend'
import type { ContextContribution } from '../context-fabric/contracts'
import { mergeCompletionReferences } from '../autocomplete/completion-references'
import { packCompletionContext, renderCompletionContext } from '../autocomplete/completion-context'
import { extractIdentifiers } from '../autocomplete/predict-next-edit-context'
import {
  INLINE_COMPLETION_SURFACE_IDS,
  isContributedSurfaceId,
  type CompletionReference,
  type InlineCompletionRequest,
  type InlineCompletionResult,
  type InlineCompletionResponse,
  type InlineCompletionSurfaceId,
} from '../inline-completion/contracts'

/** Bound idle work even when the caller does not supply its own tighter deadline. */
export const INLINE_COMPLETION_DEADLINE_MS = 15_000

/** A payload is opaque here: core's own surfaces narrow it, a contributed one validates its own. */
type AnyPayload = unknown

/** The chat composer's chips are linked anchors; the socket schema has already bounded them. */
function chatReferences(req: InlineCompletionRequest): CompletionReference[] {
  const chat = req.surfaces.chat as { references?: CompletionReference[] } | undefined
  return (chat?.references ?? []).map((reference) => ({ ...reference, origin: 'linked' as const }))
}

export interface InlineCompletionServiceDeps extends AuxLanguageModelDeps, SurfaceContextDeps {
  /**
   * Resolve one surface's OWN grounding on the server, as contributions. Core admits and clips
   * it before composing it into that surface's fragment (`surface-context.ts`).
   */
  resolveContext: SurfaceContextResolver
  /**
   * The surface a mini app contributed under this id, or undefined. Resolved per call so a mini app
   * toggle takes effect in both directions; core's own surfaces never reach it.
   */
  contributedSurface?: (id: string) => MiniAppTextInputCompletionSurface | undefined
  /** The model-answer cache; one per service by default (`model-call.ts`). Tests inject theirs. */
  resultCache?: ReturnType<typeof completionCache>
  /** Record this aux call's tokens in the usage ledger (optional, fire-and-forget). */
  recordUsage?: (e: {
    userId: string
    sessionId: string
    modelId: string
    providerConnectionId?: string | null
    providerId?: string | null
    usage: Usage | undefined
  }) => void
}

/** Suggestions are one short line per surface — keep the token ceiling tiny. */
export function createInlineCompletionService(deps: InlineCompletionServiceDeps) {
  const cache = deps.resultCache ?? completionCache()
  /**
   * One spec per surface, whoever owns it. A contributed surface implements the same five
   * questions core's own do — the SDK port and this spec are deliberately the same shape — so the
   * adapter is a rename, not a translation, and there is nothing here to fall out of step.
   */
  const surfaceSpec = (id: InlineCompletionSurfaceId): InlineCompletionSurfaceSpec | undefined => {
    if (!isContributedSurfaceId(id)) return coreInlineCompletionSurface(id)
    const contributed = deps.contributedSurface?.(id)
    return contributed
      ? {
          actionable: (payload, context) => contributed.actionable(payload, context),
          buildFragment: (payload, context) => contributed.buildFragment(payload, context),
          instruction: (payload) => contributed.instruction(payload),
          clean: (raw, payload) => contributed.clean(raw, payload),
        }
      : undefined
  }

  /**
   * Produce per-surface completions in ONE model round-trip. Returns `{}` when
   * no surface is actionable, there is no model, the request is aborted, or the
   * model produces nothing usable — the UI simply shows no ghost text.
   */
  async function completeDetailed(
    userId: string,
    req: InlineCompletionRequest,
    signal?: AbortSignal,
    deadlineAtMs?: number,
  ): Promise<InlineCompletionResponse> {
    const startedAt = Date.now()
    const finish = (
      outcome: InlineCompletionResponse['outcome'],
      completions: InlineCompletionResult = {},
    ): InlineCompletionResponse => ({ outcome, completions, durationMs: Date.now() - startedAt })
    if (signal?.aborted) return finish('cancelled')

    const operation = startCompletionOperation(
      deadlineAtMs ?? Date.now() + INLINE_COMPLETION_DEADLINE_MS,
      signal,
    )
    const { within: withinOperation, deadlineAtMs: effectiveDeadlineAtMs } = operation
    const interrupted = () => finish(operation.callerAborted() ? 'cancelled' : 'timeout')

    const resolveOwn = (surface: { id: string; payload: unknown }) =>
      withinOperation<readonly ContextContribution[]>(
        () =>
          deps.resolveContext(
            userId,
            req.sessionId,
            { surface: surface.id, payload: surface.payload },
            operation.signal,
            effectiveDeadlineAtMs,
          ),
        [],
      )

    try {
      // Core's own surfaces first, then every namespaced one the request names. Order is fixed so
      // the prompt — and therefore the request fingerprint — stays deterministic across calls.
      const requested: InlineCompletionSurfaceId[] = [
        ...INLINE_COMPLETION_SURFACE_IDS.filter((id) => req.surfaces[id] !== undefined),
        ...Object.keys(req.surfaces).filter(isContributedSurfaceId).sort(),
      ]
      if (requested.length === 0) return finish('empty')

      // Route Off is a server-side short circuit too. In particular, a disabled
      // commit surface must not run Git over a large repository merely because a
      // stale/malicious client still sent the RPC. Reuse this settings snapshot
      // during model resolution so the normal enabled path performs one read.
      const agentSettings = await withinOperation(() => deps.readAgentSettings(userId), null)
      if (operation.signal.aborted) return interrupted()
      if (!isModelRoutingTaskEnabled(agentSettings, 'inlineCompletion')) return finish('disabled')

      // Route and context are independent after the enabled gate; serial execution adds
      // provider setup time to every context read even though neither needs the other.
      const modelPromise = withinOperation(
        () =>
          resolveAuxLanguageModel(deps, userId, req.sessionId, 'inlineCompletion', {
            agentSettings,
          }),
        null,
      )

      // Every surface's own grounding and the shared working set, gathered once and in parallel
      // with the model route. Each read fails closed on its own: one broken repository or chat
      // read cannot prevent another input from being completed.
      const known = requested.filter((id) => surfaceSpec(id))
      const context = await withinOperation(
        () =>
          gatherSurfaceContext(deps, {
            userId,
            sessionId: req.sessionId,
            surfaces: known.map((id) => ({ id, payload: req.surfaces[id] })),
            references: mergeCompletionReferences(chatReferences(req), req.references),
            resolveOwn,
            signal: operation.signal,
            deadlineAtMs: effectiveDeadlineAtMs,
          }),
        { own: new Map<string, string>(), shared: [] },
      )
      if (operation.signal.aborted) return interrupted()

      // `actionable`/`buildFragment`/`instruction` are surface-owned code that can throw. This
      // function has no `catch` — only `finally` — so one such throw used to reject the whole
      // RPC, the client saw `ok:false` for EVERY surface and spent a retry from its budget.
      const parts = known.flatMap((id) => {
        const payload = req.surfaces[id]! as AnyPayload
        const spec = surfaceSpec(id)!
        const own = context.own.get(id) ?? ''
        try {
          if (!spec.actionable(payload, own)) return []
          return [
            {
              id,
              fragment: spec.buildFragment(payload, own),
              instruction: spec.instruction(payload),
            },
          ]
        } catch (error) {
          // Loud, because a surface spec throwing is a bug in ours, not bad input.
          console.warn(`[suggest] surface "${id}" failed to build its prompt fragment`, error)
          return []
        }
      })
      if (parts.length === 0) return finish('empty')
      // The working set is ranked against what the surfaces actually say — drafts and their own
      // grounding — so the excerpt of an open file is the part about the words being typed.
      const sharedContext = renderCompletionContext(
        packCompletionContext(context.shared, {
          querySymbols: new Set(extractIdentifiers(parts.map((part) => part.fragment).join('\n'))),
          budget: SHARED_CONTEXT_BUDGET,
        }),
      )
      const resolved = await modelPromise
      if (operation.signal.aborted) return interrupted()
      if (!resolved) return finish('no_model')

      // The billable call, behind the result cache: the identical prompt on the same model is
      // the same answer, and concurrent askers share one call (`model-call.ts`). A caller abort
      // or an exceeded deadline keeps the fail-closed `{}` contract.
      const prompt = buildInlineCompletionPrompt(parts, sharedContext)
      const payloads = Object.fromEntries(parts.map((part) => [part.id, req.surfaces[part.id]]))
      const key = completionFingerprint({ userId, model: resolved, prompt, payloads })
      // `get` first: `run` joins a call in flight but does not read what one already answered.
      const answer =
        cache.get(key) ??
        (await cache.run(
          key,
          (flightSignal) =>
            askCompletionModel({
              userId,
              sessionId: req.sessionId,
              resolved,
              parts,
              prompt,
              inputTokens: declaredInputTokenBudget(parts.map((part) => part.id)),
              specFor: surfaceSpec,
              payloadFor: (id) => req.surfaces[id] as AnyPayload,
              recordUsage: deps.recordUsage,
              signal: flightSignal,
              deadlineAtMs: effectiveDeadlineAtMs,
            }),
          operation.signal,
        ))
      if (answer.outcome === 'cancelled' || operation.signal.aborted) return interrupted()
      return finish(answer.outcome, answer.completions)
    } finally {
      operation.dispose()
    }
  }

  async function complete(
    userId: string,
    req: InlineCompletionRequest,
    signal?: AbortSignal,
    deadlineAtMs?: number,
  ): Promise<InlineCompletionResult> {
    return (await completeDetailed(userId, req, signal, deadlineAtMs)).completions
  }
  return { complete, completeDetailed }
}

export type InlineCompletionService = ReturnType<typeof createInlineCompletionService>
