/**
 * A CATALOG ENTRY MADE CALLABLE: the provider SDK model that serves it, and the profile its
 * requests are shaped by.
 *
 * Each SDK is imported the first time a model of its family is asked for, so a process that only
 * ever talks to one provider loads one provider package.
 */
import type { Experimental_DecisionModelV4, LanguageModelV4 } from '@ai-sdk/provider'
import type { ReasoningEffort } from '@localixai/agent'

import type { CatalogEntry } from '../catalog/catalog'
import { CODEX_PROVIDER_ID } from '../catalog/normalize'
import type { WireProfile } from '../wire/prompt'

/** How a request reaches the provider for this run: credential, address, headers. */
export interface ProviderAccess {
  apiKey?: string
  /** Sent as `Authorization: Bearer` where the SDK distinguishes it from an API key. */
  authToken?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
}

const reasons = (entry: CatalogEntry) => entry.model.reasoning.length > 0

/** OpenRouter's reasoning efforts: no `max`, and `off` is `none`. */
function openrouterEffort(effort: ReasoningEffort): string {
  return effort === 'off' ? 'none' : effort === 'max' ? 'xhigh' : effort
}

/**
 * Where requests go. An access that names its own host (Copilot's per-account endpoint) moves the
 * provider, and a model address that extends the provider's (`…/v1` for Claude on Copilot) moves
 * with it.
 */
export function addressOf(entry: CatalogEntry, access: ProviderAccess): string | undefined {
  const route = entry.route.baseURL
  if (!access.baseURL) return route
  const base = entry.provider.baseURL
  if (route && base && route !== base && route.startsWith(base))
    return access.baseURL.replace(/\/+$/, '') + route.slice(base.length)
  return access.baseURL
}

/** How requests to one provider family are shaped. */
export function profileFor(entry: CatalogEntry): WireProfile {
  const temperature = entry.model.temperature
  switch (entry.route.family) {
    case 'openai':
      return {
        namespace: 'openai',
        cacheBreakpoints: false,
        temperature,
        // Nothing is stored at OpenAI: the history travels with every request, reasoning as
        // encrypted items so the next request can continue it. The session id keys the cache.
        requestOptions: ({ sessionId, reasoningEffort }) => ({
          store: false,
          promptCacheKey: sessionId,
          ...(reasons(entry) && reasoningEffort !== 'off'
            ? { include: ['reasoning.encrypted_content'], reasoningSummary: 'auto' }
            : {}),
        }),
        // The ChatGPT backend refuses a requested output limit.
        ...(entry.provider.id === CODEX_PROVIDER_ID ? { refusesOutputLimit: true } : {}),
      }
    case 'anthropic':
      return { namespace: 'anthropic', cacheBreakpoints: true, temperature }
    case 'google':
      return { namespace: 'google', cacheBreakpoints: false, temperature }
    case 'openrouter':
      return {
        namespace: 'openrouter',
        cacheBreakpoints: false,
        temperature,
        // Its billed cost comes back with the usage; Anthropic models behind it cache automatically.
        // Its SDK reads no standard reasoning setting, only its own.
        requestOptions: ({ reasoningEffort }) => ({
          usage: { include: true },
          ...(reasons(entry) && reasoningEffort
            ? { reasoning: { effort: openrouterEffort(reasoningEffort) } }
            : {}),
          ...(entry.model.id.startsWith('anthropic/')
            ? { cache_control: { type: 'ephemeral' } }
            : {}),
        }),
      }
    case 'gateway':
      return { namespace: 'gateway', cacheBreakpoints: false, temperature }
    case 'openai-compatible':
      return entry.provider.local
        ? {
            namespace: entry.provider.id,
            cacheBreakpoints: false,
            temperature,
            // llama.cpp thinks when the chat template says so: `enable_thinking` (Gemma, Qwen) or
            // a `reasoning_effort` (gpt-oss), both carried as template arguments.
            requestOptions: ({ reasoningEffort }) =>
              reasons(entry)
                ? {
                    chat_template_kwargs: {
                      enable_thinking: reasoningEffort !== 'off',
                      ...(reasoningEffort && reasoningEffort !== 'off'
                        ? { reasoning_effort: reasoningEffort }
                        : {}),
                    },
                  }
                : undefined,
          }
        : { namespace: entry.provider.id, cacheBreakpoints: false, temperature }
  }
}

export async function languageModelFor(
  entry: CatalogEntry,
  access: ProviderAccess,
): Promise<LanguageModelV4> {
  const { apiKey, headers, fetch } = access
  const baseURL = addressOf(entry, access)
  const common = {
    ...(baseURL ? { baseURL } : {}),
    ...(headers ? { headers } : {}),
    ...(fetch ? { fetch } : {}),
  }
  const id = entry.model.id
  switch (entry.route.family) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openai = createOpenAI({ ...common, ...(apiKey ? { apiKey } : {}) })
      return entry.route.shape === 'completions' ? openai.chat(id) : openai.responses(id)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({
        ...common,
        ...(access.authToken ? { authToken: access.authToken } : apiKey ? { apiKey } : {}),
      }).languageModel(id)
    }
    case 'google': {
      const { createGoogle } = await import('@ai-sdk/google')
      return createGoogle({ ...common, ...(apiKey ? { apiKey } : {}) }).languageModel(id)
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      return createOpenRouter({ ...common, ...(apiKey ? { apiKey } : {}) }).chat(
        id,
      ) as unknown as LanguageModelV4
    }
    case 'gateway': {
      const { createGateway } = await import('@ai-sdk/gateway')
      return createGateway({ ...common, ...(apiKey ? { apiKey } : {}) }).languageModel(id)
    }
    case 'openai-compatible': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      if (!baseURL) throw new Error(`${entry.provider.name} has no address to send requests to`)
      return createOpenAICompatible({
        name: entry.provider.id,
        baseURL,
        ...(apiKey ? { apiKey } : {}),
        ...(headers ? { headers } : {}),
        ...(fetch ? { fetch } : {}),
        includeUsage: true,
      }).chatModel(id)
    }
  }
}

/**
 * A decision model on the contract's earlier name (`doEvaluate`, as OpenRouter's SDK still ships
 * it, against its own copy of the types): the same call and the same answer under another name,
 * so it is wrapped. A cast once hid the missing `doDecide` until the first live request.
 */
function asDecisionModel(model: {
  specificationVersion: 'v4'
  provider: string
  modelId: string
  supportedQuestionTypes: readonly string[]
  doEvaluate(options: never): PromiseLike<unknown>
}): Experimental_DecisionModelV4 {
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    supportedQuestionTypes:
      model.supportedQuestionTypes as Experimental_DecisionModelV4['supportedQuestionTypes'],
    doDecide: (options) =>
      model.doEvaluate(options as never) as ReturnType<Experimental_DecisionModelV4['doDecide']>,
  }
}

/** The provider's decision model, for the families that have one. */
export async function decisionModelFor(
  entry: CatalogEntry,
  access: ProviderAccess,
): Promise<Experimental_DecisionModelV4> {
  const { apiKey, headers, fetch } = access
  const baseURL = addressOf(entry, access)
  const common = {
    ...(baseURL ? { baseURL } : {}),
    ...(headers ? { headers } : {}),
    ...(fetch ? { fetch } : {}),
    ...(apiKey ? { apiKey } : {}),
  }
  switch (entry.route.family) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI(common).decisionModel(entry.model.id)
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      return asDecisionModel(createOpenRouter(common).evaluationModel(entry.model.id))
    }
    case 'gateway': {
      const { createGateway } = await import('@ai-sdk/gateway')
      return createGateway(common).decisionModel(entry.model.id)
    }
    default:
      throw new Error(`${entry.provider.name} has no decision models`)
  }
}
