import type { JsonObject, Model as PiModel } from '@earendil-works/pi-ai'
import { thinkingBudgetForLevel } from '@earendil-works/pi-ai/api/simple-options'

import type {
  DecisionRequest,
  DecisionResult,
  LanguageModel,
  LanguageModelFactory,
  RuntimeCredential,
  RuntimeCredentialStore,
  RuntimeModelRef,
} from '@localixai/agent/runtime'
import type { AssistantMessage, Usage } from '@localixai/agent'

import { createPiModels } from './models'
import { fromPiAssistant, fromPiUsage, toPiMessage } from './message-codec'
import { requestTuning, type PiRequestTuning } from './stream-options'
import { resolveReasoningEffort } from './preflight'

export type PiLanguageModelOptions = PiRequestTuning

/**
 * A Pi buffered completion settles with an AssistantMessage even when the
 * provider failed or the request was cancelled. The engine-neutral
 * LanguageModel port uses the conventional Promise contract instead: resolved
 * values are usable completions and terminal failures reject.
 *
 * Keep the converted message and usage on the error. A provider can report
 * billed tokens before a stream fails; auxiliary callers such as titling can
 * then account for those tokens without depending on Pi's message shape.
 */
export class PiLanguageModelCompletionError extends Error {
  readonly assistantMessage: AssistantMessage
  readonly usage: Usage | undefined
  readonly stopReason: 'error' | 'aborted'

  constructor(assistantMessage: AssistantMessage & { stopReason: 'error' | 'aborted' }) {
    super(
      assistantMessage.errorMessage ||
        (assistantMessage.stopReason === 'aborted'
          ? 'Request was aborted'
          : 'The provider returned an unsuccessful completion'),
    )
    this.name =
      assistantMessage.stopReason === 'aborted' ? 'AbortError' : 'PiLanguageModelCompletionError'
    this.assistantMessage = assistantMessage
    this.usage = assistantMessage.usage
    this.stopReason = assistantMessage.stopReason
  }
}

/**
 * Convert Pi's terminal-message outcome into the LanguageModel Promise
 * contract. Exported as a small conformance seam so tests can pin the adapter
 * boundary without mocking Pi's model registry or transport.
 */
export function fromPiCompletion(message: Parameters<typeof fromPiAssistant>[0]): AssistantMessage {
  const completion = fromPiAssistant(message)
  if (completion.stopReason === 'error' || completion.stopReason === 'aborted') {
    throw new PiLanguageModelCompletionError(
      completion as AssistantMessage & { stopReason: 'error' | 'aborted' },
    )
  }
  return completion
}

/**
 * ChatGPT's Codex Responses endpoint rejects sampling temperature for its
 * reasoning models. Other providers may use it, so normalize at the adapter
 * boundary where the concrete API is known instead of teaching every caller
 * about provider quirks.
 */
export function normalizeCompletionTemperature(
  model: Pick<PiModel<string>, 'api'>,
  temperature: number | undefined,
): number | undefined {
  return model.api === 'openai-codex-responses' ? undefined : temperature
}

/**
 * Off cannot disable mandatory reasoning: omitting it leaves the provider's default
 * effort in control. `resolveReasoningEffort` clamps it against the live model to request its
 * minimum instead — the same rule the agent loop applies.
 */
export function normalizeCompletionReasoning(
  model: PiModel<string>,
  requested: Parameters<LanguageModel['complete']>[0]['reasoningEffort'],
) {
  return resolveReasoningEffort(model, requested).effort
}

/** Adapters that already add the thinking budget ON TOP of the caller's `maxTokens`. */
const API_RESERVES_THINKING_ROOM = new Set(['anthropic-messages', 'bedrock-converse-stream'])

/**
 * A caller's `maxOutputTokens` is room for the ANSWER; reasoning must not be able to spend it.
 *
 * pi's Anthropic and Bedrock adapters already read it that way (`adjustMaxTokensForThinking`
 * adds the thinking budget to the ceiling). OpenAI Completions/Responses, Codex and Gemini do
 * not: reasoning tokens count against the same `max_*_tokens`. Inline completion asks for 64
 * tokens with reasoning off, and ~350 catalog models on those APIs cannot switch reasoning off
 * (the clamp above picks `minimal`, `low` or even `high`). Their thinking consumed the whole
 * ceiling, the reply ended in `max_tokens`, and the surface saw a billed call with no suggestion,
 * on every keystroke, with nothing turning red. Adding pi's own budget for the effective level
 * gives the reasoning its room; it is a ceiling, so a model that thinks less is billed less.
 */
export function normalizeCompletionMaxTokens(
  model: Pick<PiModel<string>, 'api' | 'maxTokens'>,
  maxOutputTokens: number | undefined,
  effort: ReturnType<typeof normalizeCompletionReasoning>,
): number | undefined {
  if (maxOutputTokens === undefined || effort === undefined) return maxOutputTokens
  if (API_RESERVES_THINKING_ROOM.has(model.api)) return maxOutputTokens
  const withRoom = maxOutputTokens + thinkingBudgetForLevel(effort)
  return model.maxTokens > 0
    ? Math.min(withRoom, Math.max(model.maxTokens, maxOutputTokens))
    : withRoom
}

class PiLanguageModel implements LanguageModel {
  readonly ref: RuntimeModelRef
  private readonly credential: RuntimeCredential
  private readonly options: PiLanguageModelOptions
  private readonly credentialStore: RuntimeCredentialStore | undefined

  constructor(
    ref: RuntimeModelRef,
    credential: RuntimeCredential,
    options: PiLanguageModelOptions,
    credentialStore?: RuntimeCredentialStore,
  ) {
    this.ref = ref
    this.credential = credential
    this.options = options
    this.credentialStore = credentialStore
  }

  async complete(request: Parameters<LanguageModel['complete']>[0]) {
    request.signal?.throwIfAborted()
    const models = createPiModels(this.ref, this.credential, this.credentialStore)
    const model = models.getModel(this.ref.providerId, this.ref.modelId)
    if (!model) throw new Error(`Unknown pi model ${this.ref.providerId}/${this.ref.modelId}`)
    const reasoning = normalizeCompletionReasoning(
      model as PiModel<string>,
      request.reasoningEffort,
    )
    const response = await models.completeSimple(
      model as PiModel<string>,
      {
        systemPrompt: request.systemPrompt,
        messages: request.messages.flatMap(toPiMessage),
      },
      {
        signal: request.signal,
        temperature: normalizeCompletionTemperature(model as PiModel<string>, request.temperature),
        maxTokens: normalizeCompletionMaxTokens(
          model as PiModel<string>,
          request.maxOutputTokens,
          reasoning,
        ),
        reasoning,
        cacheRetention: request.cacheRetention,
        sessionId: request.sessionId,
        ...requestTuning(this.options),
      },
    )
    return fromPiCompletion(response)
  }

  /** pi's classifier call: the model must be a `classifier` entry of the owning provider. */
  async decide(request: DecisionRequest): Promise<DecisionResult> {
    request.signal?.throwIfAborted()
    const models = createPiModels(this.ref, this.credential, this.credentialStore)
    const model = models.getModelOfType('classifier', this.ref.providerId, this.ref.modelId)
    if (!model)
      throw new Error(`Unknown pi decision model ${this.ref.providerId}/${this.ref.modelId}`)
    const result = await models.classify(
      model,
      { state: request.state as JsonObject, questions: request.questions },
      { signal: request.signal },
    )
    if (result.stopReason !== 'stop')
      throw new Error(result.errorMessage || `Decision request ${result.stopReason}`)
    const answers: DecisionResult['answers'] = {}
    for (const [key, answer] of Object.entries(result.answers)) {
      if (answer.type === 'choice')
        answers[key] = {
          type: 'choice',
          choice: answer.choice,
          probabilities: { ...answer.probabilities },
        }
      else if (answer.type === 'bool')
        answers[key] = { type: 'bool', probability: answer.probability }
    }
    return { answers, ...(result.usage ? { usage: fromPiUsage(result.usage) } : {}) }
  }
}

export function createPiLanguageModelFactory(
  options: PiLanguageModelOptions = {},
): LanguageModelFactory {
  return {
    create(model, credential, credentialStore) {
      return new PiLanguageModel(model, credential, options, credentialStore)
    },
  }
}
