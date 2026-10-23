/**
 * THE BILLABLE PART OF AN INLINE COMPLETION — one model call over the composed prompt, parsed and
 * cleaned per surface — behind a result cache with single-flight (`lib/result-cache.ts`).
 *
 * Everything before this point (settings, model route, context) is cheap and changes often; this
 * call is the one that costs, and it is asked the SAME question again more than anything else in
 * the app: an empty composer under an unchanged last reply produces the identical prompt every
 * time it is shown — a reload, a session switch back, a focus after the client's own cache
 * lapsed. Keyed by a fingerprint of the exact prompt and model route, such a repeat costs nothing,
 * and two windows asking at once share one call. Only an ANSWER is kept (a suggestion, or the
 * model's confident "nothing"); a failure or an abort never is.
 */
import { sha256Hex } from '../edit-prediction/cache/keys'
import { messageText } from '../edit-prediction/model/adapter'
import { createResultCache } from '../../lib/result-cache'
import { executeModelTask } from '../model-task-runtime'
import type { resolveAuxLanguageModel } from '../autocomplete/resolve-model'
import type {
  InlineCompletionResponse,
  InlineCompletionResult,
  InlineCompletionSurfaceId,
} from '../inline-completion/contracts'
import { parseSurfaceLines } from './parse'
import { MAX_TOKENS_PER_SURFACE, SYSTEM_PROMPT } from './prompt'
import type { InlineCompletionSurfaceSpec } from './surfaces'
import type { InlineCompletionServiceDeps } from './service'

/** Shared Model Task Runtime recipe identity (execution infra only; prompt/parse stay local). */
const INLINE_COMPLETION_TASK = { id: 'inline-input-completion', version: 2 } as const

export interface CompletionPart {
  id: InlineCompletionSurfaceId
  fragment: string
  instruction: string
}

type ModelAnswer = Pick<InlineCompletionResponse, 'outcome' | 'completions'>
type ResolvedModel = NonNullable<Awaited<ReturnType<typeof resolveAuxLanguageModel>>>

/**
 * A reply prediction stays right for as long as its last message stays last, so a suggestion is
 * kept long; the model's "nothing to suggest" is kept shorter, in case the context around it
 * (open tabs, chips) moves while the draft does not.
 */
export const completionCache = () =>
  createResultCache<ModelAnswer>(
    {
      isCacheable: (answer) => answer.outcome === 'suggested' || answer.outcome === 'empty',
      isPositive: (answer) => answer.outcome === 'suggested',
      cancelled: { outcome: 'cancelled', completions: {} },
    },
    { maxBytes: 256 * 1024, positiveTtlMs: 10 * 60_000, negativeTtlMs: 2 * 60_000 },
  )

/** The identity of a question: who asks, on which model, with exactly which prompt and payloads. */
export function completionFingerprint(input: {
  userId: string
  model: Pick<ResolvedModel, 'modelId' | 'providerConnectionId' | 'reasoningEffort'>
  prompt: string
  payloads: Record<string, unknown>
}): string {
  return `inline:${sha256Hex(
    JSON.stringify([
      INLINE_COMPLETION_TASK.version,
      input.userId,
      input.model.modelId,
      input.model.providerConnectionId ?? null,
      input.model.reasoningEffort ?? null,
      SYSTEM_PROMPT,
      input.prompt,
      input.payloads,
    ]),
  )}`
}

/** One model call, parsed into each surface's cleaned ghost text. */
export async function askCompletionModel(args: {
  userId: string
  sessionId: string
  resolved: ResolvedModel
  parts: readonly CompletionPart[]
  prompt: string
  inputTokens: number
  specFor: (id: InlineCompletionSurfaceId) => InlineCompletionSurfaceSpec | undefined
  payloadFor: (id: InlineCompletionSurfaceId) => unknown
  recordUsage: InlineCompletionServiceDeps['recordUsage']
  signal: AbortSignal
  deadlineAtMs: number
}): Promise<ModelAnswer> {
  const { model, modelId, providerConnectionId, providerId, reasoningEffort } = args.resolved
  const maxTokens = MAX_TOKENS_PER_SURFACE * args.parts.length
  const outcome = await executeModelTask({
    request: {
      task: INLINE_COMPLETION_TASK,
      system: SYSTEM_PROMPT,
      input: args.prompt,
      budget: { inputTokens: args.inputTokens, outputTokens: maxTokens },
      capabilities: { streaming: false },
      signal: args.signal,
      deadlineAtMs: args.deadlineAtMs,
    },
    execute: async (request, taskSignal) => {
      // Deliberately no `cacheRetention`: SYSTEM_PROMPT is static but far below every provider
      // cache minimum, while the user content is rebuilt from the live draft and context — and
      // providers mark the last message as well as the system prefix, so retention would write
      // an entry nothing ever reads back. The cache that pays here is this module's own.
      const message = await model.complete({
        systemPrompt: request.system,
        messages: [{ role: 'user', content: request.input, timestamp: Date.now() }],
        temperature: 0.2,
        maxOutputTokens: maxTokens,
        reasoningEffort: reasoningEffort ?? 'off',
        sessionId: args.sessionId,
        signal: taskSignal,
      })
      return { output: message, usage: message.usage }
    },
  })
  if (outcome.status !== 'success')
    return { outcome: args.signal.aborted ? 'cancelled' : 'error', completions: {} }
  const message = outcome.response.output
  // Count this aux call's spend ONCE (one call = one spend event; splitting tokens per surface
  // would be arbitrary). A cache hit never reaches here, so a repeat is never billed twice.
  args.recordUsage?.({
    userId: args.userId,
    sessionId: args.sessionId,
    modelId,
    providerConnectionId,
    providerId,
    usage: message.usage,
  })
  if (message.stopReason === 'max_tokens') return { outcome: 'error', completions: {} }

  const lines = parseSurfaceLines(
    messageText(message.content),
    args.parts.map((part) => part.id),
  )
  const completions: InlineCompletionResult = {}
  for (const { id } of args.parts) {
    const spec = args.specFor(id)
    if (!spec) continue
    // The call is already made, billed and recorded. A throwing cleaner used to discard every
    // surface's answer at the one moment when throwing away is most expensive — keep the rest.
    try {
      const cleaned = spec.clean(lines[id] ?? '', args.payloadFor(id))
      if (cleaned) completions[id] = cleaned
    } catch (error) {
      console.warn(`[suggest] surface "${id}" failed to clean its completion`, error)
    }
  }
  return { outcome: Object.keys(completions).length ? 'suggested' : 'empty', completions }
}
