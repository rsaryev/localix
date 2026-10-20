/**
 * BUFFERED CALLS for the host's auxiliary work — titles, inline completion, judges — and decision
 * models for routing and plugins. The same catalog, credentials and provider SDKs as a run; one
 * request each, no tools.
 */
import type { AssistantMessage, ReasoningEffort, Usage } from '@localixai/agent'
import type {
  DecisionAnswer,
  DecisionRequest,
  DecisionResult,
  LanguageModel,
  LanguageModelFactory,
  LanguageModelRequest,
} from '@localixai/agent/runtime'

import { accessFor } from './auth/auth'
import { bindModel, reasoningFor, resolveEntry, type ModelAccessOptions } from './model-access'
import { decisionModelFor } from './providers/connect'
import { createModelSession } from './session'
import { priceUsage } from './usage'

/**
 * A completion that did not complete. The provider may have billed tokens before failing, so the
 * message and its usage stay on the error for a caller that accounts for them.
 */
export class LanguageModelCompletionError extends Error {
  readonly assistantMessage: AssistantMessage
  readonly usage: Usage | undefined
  readonly stopReason: 'error' | 'aborted'
  constructor(message: AssistantMessage & { stopReason: 'error' | 'aborted' }, cause?: Error) {
    super(
      message.errorMessage ||
        (message.stopReason === 'aborted'
          ? 'Request was aborted'
          : 'The provider returned an unsuccessful completion'),
      cause ? { cause } : undefined,
    )
    this.name = message.stopReason === 'aborted' ? 'AbortError' : 'LanguageModelCompletionError'
    this.assistantMessage = message
    this.usage = message.usage
    this.stopReason = message.stopReason
  }
}

/** Room reasoning may take on top of the answer, per level (Anthropic adds it to the ceiling itself). */
const THINKING_ROOM: Readonly<Record<string, number>> = {
  minimal: 1_024,
  low: 2_048,
  medium: 8_192,
  high: 16_384,
  xhigh: 16_384,
  max: 16_384,
}

/**
 * A caller's `maxOutputTokens` is room for the ANSWER. On wires where reasoning counts against the
 * same ceiling, a model that cannot switch reasoning off would think its way through all of it and
 * answer nothing; its reasoning gets room of its own, capped at what the model can emit.
 */
function answerRoom(
  api: string,
  maxOutputTokens: number | undefined,
  effort: ReasoningEffort | undefined,
  modelMax: number | undefined,
) {
  if (maxOutputTokens === undefined || effort === undefined || effort === 'off')
    return maxOutputTokens
  if (api === 'anthropic-messages') return maxOutputTokens
  const withRoom = maxOutputTokens + (THINKING_ROOM[effort] ?? 0)
  return modelMax ? Math.min(withRoom, Math.max(modelMax, maxOutputTokens)) : withRoom
}

function decisionAnswer(answer: {
  type: string
  [key: string]: unknown
}): DecisionAnswer | undefined {
  if (answer.type === 'choice' && typeof answer.choice === 'string') {
    return {
      type: 'choice',
      choice: answer.choice,
      probabilities: { ...(answer.probabilities as Record<string, number> | undefined) },
    }
  }
  if (answer.type === 'boolean' && typeof answer.probability === 'number')
    return { type: 'bool', probability: answer.probability }
  return undefined
}

export function createLanguageModelFactory(options: ModelAccessOptions): LanguageModelFactory {
  return {
    create(ref, credential, credentialStore): LanguageModel {
      return {
        ref,
        async complete(request: LanguageModelRequest): Promise<AssistantMessage> {
          request.signal?.throwIfAborted()
          const signal = request.signal ?? new AbortController().signal
          const entry = await resolveEntry(options.catalog, ref)
          const bound = await bindModel(
            options,
            {
              model: ref,
              credential,
              ...(credentialStore ? { credentialStore } : {}),
              sessionId: request.sessionId ?? `aux-${crypto.randomUUID()}`,
              signal,
            },
            entry,
          )
          const effort = reasoningFor(entry, request.reasoningEffort)
          const maxOutputTokens = answerRoom(
            entry.model.api,
            request.maxOutputTokens,
            effort,
            entry.model.maxOutputTokens,
          )
          const turn = createModelSession(bound, {
            sessionId: request.sessionId ?? 'aux',
            ...(options.retry ? { retry: options.retry } : {}),
          }).turn({
            systemPrompt: request.systemPrompt,
            messages: request.messages,
            tools: [],
            ...(effort ? { reasoningEffort: effort } : {}),
            ...(maxOutputTokens ? { maxOutputTokens } : {}),
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
            signal,
          })
          const message = await turn.message
          if (message.stopReason === 'error' || message.stopReason === 'aborted') {
            throw new LanguageModelCompletionError(
              message as AssistantMessage & { stopReason: 'error' | 'aborted' },
              turn.failure,
            )
          }
          return message
        },

        async decide(request: DecisionRequest): Promise<DecisionResult> {
          request.signal?.throwIfAborted()
          const signal = request.signal ?? new AbortController().signal
          const entry = await resolveEntry(options.catalog, ref, 'decision')
          const { access } = await accessFor(entry, credential, {
            signal,
            ...(credentialStore ? { store: credentialStore } : {}),
          })
          const model = await decisionModelFor(entry, access)
          const questions = Object.fromEntries(
            Object.entries(request.questions).map(([key, question]) => [
              key,
              question.type === 'choice'
                ? {
                    type: 'choice' as const,
                    instructions: question.instructions,
                    criteria: question.criteria,
                  }
                : {
                    type: 'boolean' as const,
                    instructions: question.instructions,
                    criteria: question.criteria,
                  },
            ]),
          )
          const result = await model.doDecide({
            state: [{ type: 'json', value: request.state as never }],
            questions,
            abortSignal: signal,
          })
          const answers: DecisionResult['answers'] = {}
          for (const [key, answer] of Object.entries(result.answers)) {
            const mapped = decisionAnswer(answer as { type: string })
            if (mapped) answers[key] = mapped
          }
          const usage = result.usage
            ? priceUsage(
                {
                  inputTokens: result.usage.inputTokens ?? 0,
                  outputTokens: result.usage.outputTokens ?? 0,
                },
                {
                  ...(entry.model.cost ? { cost: entry.model.cost } : {}),
                  subscription: false,
                  ...(result.providerMetadata ? { metadata: result.providerMetadata } : {}),
                },
              )
            : undefined
          return { answers, ...(usage ? { usage } : {}) }
        },
      }
    },
  }
}
