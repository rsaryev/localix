/**
 * A CATALOG ENTRY MADE CALLABLE: the provider SDK model that serves it, and the profile its
 * requests are shaped by.
 *
 * Each SDK is imported the first time a model of its family is asked for, so a process that only
 * ever talks to one provider loads one provider package.
 */
import type { Experimental_DecisionModelV4, LanguageModelV4 } from '@ai-sdk/provider'
import type { ReasoningEffort } from '@localixai/agent'

import { PINNED_ADDRESS } from '../catalog/addresses'
import type { CatalogEntry } from '../catalog/catalog'
import type { ProviderFamily } from '../catalog/families'
import { CODEX_PROVIDER_ID } from '../catalog/normalize'
import { fillTemplate } from '../catalog/settings'
import type { WireProfile } from '../wire/prompt'
import { CLOUD_FAMILIES, cloudModelFor, cloudProfile } from './clouds'

/** How a request reaches the provider for this run: credential, address, headers. */
export interface ProviderAccess {
  apiKey?: string
  /** Sent as `Authorization: Bearer` where the SDK distinguishes it from an API key. */
  authToken?: string
  baseURL?: string
  headers?: Record<string, string>
  fetch?: typeof globalThis.fetch
  /** What the connection names besides its key (`AWS_REGION`, `AZURE_RESOURCE_NAME`, …). */
  settings?: Readonly<Record<string, string>>
}

const reasons = (entry: CatalogEntry) => entry.model.reasoning.length > 0

/** OpenRouter's reasoning efforts: no `max`, and `off` is `none`. */
function openrouterEffort(effort: ReasoningEffort): string {
  return effort === 'off' ? 'none' : effort === 'max' ? 'xhigh' : effort
}

/**
 * Where each first-party SDK sends requests when models.dev names no address. Always passed
 * explicitly: left out, these SDKs read `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`… from the server's
 * environment — which the login shell fills from the user's dotfiles — and a connection's key would
 * follow that variable to whatever proxy it names.
 */
const FAMILY_ADDRESS: Partial<Record<ProviderFamily, string>> = {
  openai: PINNED_ADDRESS.openai,
  anthropic: PINNED_ADDRESS.anthropic,
  google: PINNED_ADDRESS.google,
  openrouter: PINNED_ADDRESS.openrouter,
  gateway: PINNED_ADDRESS.vercel,
}

/**
 * Where requests go. An access that names its own host (Copilot's per-account endpoint) moves the
 * provider, and a model address that extends the provider's (`…/v1` for Claude on Copilot) moves
 * with it.
 */
export function addressOf(entry: CatalogEntry, access: ProviderAccess): string | undefined {
  // An address naming the connection's settings (`https://${AZURE_RESOURCE_NAME}…`) is filled first.
  const route =
    (entry.route.baseURL && fillTemplate(entry.route.baseURL, access.settings)) ||
    FAMILY_ADDRESS[entry.route.family]
  if (!access.baseURL) return route
  const base = entry.provider.baseURL
  if (route && base && route !== base && route.startsWith(base))
    return access.baseURL.replace(/\/+$/, '') + route.slice(base.length)
  return access.baseURL
}

/**
 * OpenAI's requests: nothing is stored there, so the history travels with every request,
 * reasoning as encrypted items so the next request can continue it. The session id keys the cache.
 */
function openaiOptions(entry: CatalogEntry): WireProfile['requestOptions'] {
  return ({ sessionId, reasoningEffort }) => ({
    store: false,
    promptCacheKey: sessionId,
    ...(reasons(entry) && reasoningEffort !== 'off'
      ? { include: ['reasoning.encrypted_content'], reasoningSummary: 'auto' }
      : {}),
  })
}

/** How requests to one provider family are shaped. */
export function profileFor(entry: CatalogEntry): WireProfile {
  const temperature = entry.model.temperature
  if (CLOUD_FAMILIES.has(entry.route.family)) return cloudProfile(entry, openaiOptions(entry))
  switch (entry.route.family) {
    case 'openai':
      return {
        namespace: 'openai',
        cacheBreakpoints: false,
        temperature,
        requestOptions: openaiOptions(entry),
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
    case 'bedrock':
    case 'azure':
    case 'vertex':
    case 'vertex-anthropic':
    case 'openai-compatible':
      // The OpenAI-compatible wire: the clouds were shaped above.
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

/**
 * The key every SDK is given: always a string, even an empty one, so none of them falls back to
 * its `*_API_KEY` environment variable and sends a key this connection does not have.
 */
const keyOf = (access: ProviderAccess) => access.apiKey ?? ''

export async function languageModelFor(
  entry: CatalogEntry,
  access: ProviderAccess,
): Promise<LanguageModelV4> {
  const { headers, fetch } = access
  const apiKey = keyOf(access)
  const baseURL = addressOf(entry, access)
  const family = entry.route.family
  if (CLOUD_FAMILIES.has(family)) return cloudModelFor(entry, access, baseURL)
  const common = {
    ...(baseURL ? { baseURL } : {}),
    ...(headers ? { headers } : {}),
    ...(fetch ? { fetch } : {}),
  }
  const id = entry.model.id
  switch (family) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openai = createOpenAI({ ...common, apiKey })
      return entry.route.shape === 'completions' ? openai.chat(id) : openai.responses(id)
    }
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic')
      return createAnthropic({
        ...common,
        ...(access.authToken ? { authToken: access.authToken } : { apiKey }),
      }).languageModel(id)
    }
    case 'google': {
      const { createGoogle } = await import('@ai-sdk/google')
      return createGoogle({ ...common, apiKey }).languageModel(id)
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      return createOpenRouter({ ...common, apiKey }).chat(id) as unknown as LanguageModelV4
    }
    case 'gateway': {
      const { createGateway } = await import('@ai-sdk/gateway')
      return createGateway({ ...common, apiKey: gatewayKey(entry, access) }).languageModel(id)
    }
    case 'openai-compatible':
    case 'bedrock':
    case 'azure':
    case 'vertex':
    case 'vertex-anthropic': {
      // The OpenAI-compatible wire: the clouds were served above. Its SDK reads no environment.
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      if (!baseURL) throw new Error(`${entry.provider.name} has no address to send requests to`)
      return createOpenAICompatible({
        name: entry.provider.id,
        baseURL,
        ...(access.apiKey ? { apiKey: access.apiKey } : {}),
        ...(headers ? { headers } : {}),
        ...(fetch ? { fetch } : {}),
        includeUsage: true,
      }).chatModel(id)
    }
  }
}

/** The gateway's key: without one its SDK signs in with the server's own Vercel OIDC token. */
function gatewayKey(entry: CatalogEntry, access: ProviderAccess): string {
  if (!access.apiKey)
    throw new Error(`${entry.provider.name} needs a key; add one to the connection`)
  return access.apiKey
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
  const { headers, fetch } = access
  const baseURL = addressOf(entry, access)
  const common = {
    ...(baseURL ? { baseURL } : {}),
    ...(headers ? { headers } : {}),
    ...(fetch ? { fetch } : {}),
  }
  switch (entry.route.family) {
    case 'openai': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      return createOpenAI({ ...common, apiKey: keyOf(access) }).decisionModel(entry.model.id)
    }
    case 'openrouter': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      return asDecisionModel(
        createOpenRouter({ ...common, apiKey: keyOf(access) }).evaluationModel(entry.model.id),
      )
    }
    case 'gateway': {
      const { createGateway } = await import('@ai-sdk/gateway')
      return createGateway({ ...common, apiKey: gatewayKey(entry, access) }).decisionModel(
        entry.model.id,
      )
    }
    case 'anthropic':
    case 'google':
    case 'openai-compatible':
    case 'bedrock':
    case 'azure':
    case 'vertex':
    case 'vertex-anthropic':
      throw new Error(`${entry.provider.name} has no decision models`)
  }
}
