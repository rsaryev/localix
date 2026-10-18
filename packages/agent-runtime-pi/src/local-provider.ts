/**
 * The `local` provider: chat models running on this computer behind an OpenAI-compatible server
 * the HOST manages (llama.cpp's router in Localix). It is an ordinary pi provider — listed in
 * the catalog, connected, chosen and streamed like every other — with two differences:
 *
 *   - its model list is the host's, read on every call: what is installed plus what can be
 *     downloaded, so a download that finishes shows up without a catalog refresh;
 *   - its endpoint is resolved per request (`auth.apiKey.resolve` → `baseUrl` + per-start key),
 *     which starts the server on first use. A model still downloading is waited for — the reply
 *     comes once it is here — and one that is not coming ends its stream with a sentence that
 *     says why (`MODEL_NOT_DOWNLOADED`), instead of reaching the server.
 *
 * This package knows nothing of how the host runs the server; it sees the narrow port below.
 */
import {
  createProvider,
  lazyStream,
  type Api,
  type AssistantMessageEvent,
  type Model,
  type OpenAICompletionsOptions,
  type Provider,
} from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { MODEL_NOT_DOWNLOADED } from '@localixai/agent/agents'

export const LOCAL_PROVIDER_ID = 'local'

export interface LocalChatModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  vision: boolean
  /** Its chat template can think before answering; the picker then offers reasoning levels. */
  reasoning: boolean
}

export interface LocalProviderHost {
  /** Installed and downloadable chat models. Called on every list; keep it cheap. */
  models(): readonly LocalChatModel[]
  isInstalled(modelId: string): boolean
  /**
   * Resolve once the model is on this computer (waiting out a download in progress); reject
   * with a sentence a person can act on when it is not coming (paused, failed, never asked).
   */
  whenReady(modelId: string, signal?: AbortSignal): Promise<void>
  /** The running server (started when needed). Rejects with a sentence a person can act on. */
  endpoint(signal: AbortSignal): Promise<{ baseUrl: string; apiKey: string }>
}

/** Placeholder until a request resolves the real address. */
const UNRESOLVED_BASE_URL = 'http://127.0.0.1/v1'

export function toLocalPiModel(model: LocalChatModel): Model<'openai-completions'> {
  return {
    id: model.id,
    name: model.name,
    api: 'openai-completions',
    provider: LOCAL_PROVIDER_ID,
    baseUrl: UNRESOLVED_BASE_URL,
    input: model.vision ? ['text', 'image'] : ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: model.reasoning,
    // llama.cpp thinks when the template says so: `enable_thinking` (Gemma, Qwen) or a
    // `reasoning_effort` (gpt-oss), with the level's budget capping it so an answer remains.
    ...(model.reasoning ? { thinkingLevelMap: { minimal: null } } : {}),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens',
      ...(model.reasoning
        ? {
            thinkingFormat: 'chat-template' as const,
            chatTemplateKwargs: {
              enable_thinking: { $var: 'thinking.enabled' as const },
              reasoning_effort: { $var: 'thinking.effort' as const, omitWhenOff: true },
            },
            thinkingTokenBudgetField: 'thinking_budget_tokens' as const,
          }
        : {}),
    },
  }
}

export function createLocalProvider(host: LocalProviderHost): Provider<Api> {
  const base = createProvider<'openai-completions'>({
    id: LOCAL_PROVIDER_ID,
    name: 'Local',
    baseUrl: UNRESOLVED_BASE_URL,
    auth: {
      apiKey: {
        name: 'Local models',
        async resolve({ signal }) {
          const { baseUrl, apiKey } = await host.endpoint(signal)
          return { auth: { apiKey, baseUrl: `${baseUrl}/v1` }, source: 'Local model server' }
        },
      },
    },
    models: [],
    api: openAICompletionsApi(),
  })
  type LocalModel = Model<'openai-completions'>
  const listed = (): LocalModel[] => host.models().map(toLocalPiModel)
  /** A stream that first waits for the model to be here, then is the server's stream. */
  const whenReady = (
    model: Model<Api>,
    signal: AbortSignal | undefined,
    open: () => AsyncIterable<AssistantMessageEvent>,
  ) =>
    lazyStream(model, async () => {
      try {
        await host.whenReady(model.id, signal)
      } catch (err) {
        if (signal?.aborted) throw err
        const why = err instanceof Error ? err.message : String(err)
        throw new Error(`${MODEL_NOT_DOWNLOADED} ${why}`)
      }
      return open()
    })
  return {
    ...base,
    getModels: listed,
    getAllModels: listed,
    stream(model, context, options) {
      const open = () =>
        base.stream(model as LocalModel, context, options as OpenAICompletionsOptions)
      return host.isInstalled(model.id) ? open() : whenReady(model, options?.signal, open)
    },
    streamSimple(model, context, options) {
      const open = () => base.streamSimple(model as LocalModel, context, options)
      return host.isInstalled(model.id) ? open() : whenReady(model, options?.signal, open)
    },
  }
}
