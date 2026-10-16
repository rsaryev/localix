/**
 * One small document per upstream source of pi's generated catalog — enough for every converter,
 * the generator's `--strict` checks included — and a fetch that serves them. Tests drive a catalog
 * refresh from these; nothing reaches the network.
 */
const URLS = {
  modelsDev: 'https://models.dev/api.json',
  modelsDevDecisions: 'https://models.dev/models.json?type=decision',
  nvidiaNim: 'https://integrate.api.nvidia.com/v1/models',
  openRouter: 'https://openrouter.ai/api/v1/models',
  openRouterImages: 'https://openrouter.ai/api/v1/models?output_modalities=image',
  openRouterDecisions: 'https://openrouter.ai/api/v1/models?output_modalities=decisions',
  aiGateway: 'https://ai-gateway.vercel.sh/v1/models',
} as const

export const MODELS_DEV_URL = URLS.modelsDev

const tool = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  tool_call: true,
  limit: { context: 128000, output: 16000 },
  cost: { input: 1, output: 2 },
  ...extra,
})

const QWEN_INDIVIDUAL_IDS = [
  'deepseek-v4-flash-0731',
  'deepseek-v4-pro',
  'deepseek-v4-pro-0813',
  'glm-5.2',
  'qwen3.6-flash',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.8-flash',
  'qwen3.8-max',
]

export const GENERATED_CATALOG_DOCUMENTS: Record<string, unknown> = {
  [URLS.modelsDev]: {
    openai: {
      models: {
        'gpt-fixture-1': tool('gpt-fixture-1', {
          name: 'GPT Fixture 1',
          reasoning: true,
          release_date: '2099-01-02',
          reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high'] }],
          modalities: { input: ['text', 'image'] },
        }),
      },
    },
    anthropic: {
      models: {
        'claude-fixture-1': tool('claude-fixture-1', {
          name: 'Claude Fixture 1',
          reasoning: true,
          release_date: '2099-01-01',
        }),
      },
    },
    'zai-coding-plan': {
      models: { 'glm-fixture': tool('glm-fixture', { reasoning: true }) },
    },
    'alibaba-token-plan': {
      models: Object.fromEntries(
        QWEN_INDIVIDUAL_IDS.map((id) => [id, tool(id, { reasoning: true })]),
      ),
    },
  },
  [URLS.modelsDevDecisions]: {
    'typesafe/jev-latest': {
      id: 'typesafe/jev-latest',
      type: 'decision',
      name: 'Jev',
      limit: { context: 64000 },
    },
  },
  [URLS.nvidiaNim]: { data: [] },
  [URLS.openRouter]: {
    data: [
      {
        id: 'acme/reasoner',
        name: 'Acme Reasoner',
        created: 4070908800,
        supported_parameters: ['tools', 'reasoning'],
        architecture: { modality: 'text->text' },
        pricing: { prompt: '0.000001', completion: '0.000002' },
        context_length: 128000,
        top_provider: { context_length: 128000, max_completion_tokens: 16000 },
        reasoning: { supported_efforts: ['low', 'medium', 'high'] },
      },
      {
        id: 'acme/always-thinks',
        name: 'Acme Always Thinks',
        created: 4070908800,
        supported_parameters: ['tools', 'reasoning'],
        architecture: { modality: 'text->text' },
        pricing: { prompt: '0.000001', completion: '0.000002' },
        context_length: 64000,
        reasoning: { mandatory: true, supported_efforts: ['high'] },
      },
    ],
  },
  [URLS.openRouterImages]: {
    data: [
      {
        id: 'acme/image',
        name: 'Acme Image',
        architecture: { input_modalities: ['text'], output_modalities: ['image'] },
        pricing: { prompt: '0', completion: '0' },
      },
    ],
  },
  [URLS.openRouterDecisions]: { data: [] },
  [URLS.aiGateway]: {
    data: [
      {
        id: 'acme/gateway-reasoner',
        name: 'Gateway Reasoner',
        type: 'language',
        tags: ['tool-use', 'reasoning'],
        context_window: 100000,
        max_tokens: 8000,
        pricing: { input: '0.000001', output: '0.000002' },
        released: 4070908800,
      },
    ],
  },
}

export interface FixtureRequest {
  url: string
  headers: Record<string, string>
}

/**
 * A fetch over the fixture documents. A document with an entry in `etags` carries that ETag and
 * answers `304` to a matching `If-None-Match`; `fail` makes every request throw.
 */
export function fixtureFetch(
  options: {
    etags?: Record<string, string>
    fail?: boolean
    documents?: Record<string, unknown>
  } = {},
) {
  const requests: FixtureRequest[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    requests.push({ url, headers })
    if (options.fail) throw new Error('offline')
    const documents = options.documents ?? GENERATED_CATALOG_DOCUMENTS
    if (!(url in documents)) return new Response('not found', { status: 404 })
    const etag = options.etags?.[url]
    if (etag && headers['if-none-match'] === etag) return new Response(null, { status: 304 })
    return new Response(JSON.stringify(documents[url]), {
      status: 200,
      headers: { 'content-type': 'application/json', ...(etag ? { etag } : {}) },
    })
  }
  return { fetch: fetchImpl as typeof fetch, requests }
}
