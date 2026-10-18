/**
 * Cloud providers whose embedding models semantic search can use, through their
 * OpenAI-compatible API with an API key from the person's connection.
 *
 * No model is named here: each provider's own model list is read with that key (`/models`),
 * cached for a few hours, and an id is offered when it belongs to a known family
 * (`families.ts`), so a provider's new embedding model appears without a release of this app.
 * Indexing with one sends every indexed conversation to that provider; the picker says so.
 */
import { familyOf } from './families'

export interface ProviderEmbeddings {
  providerId: string
  /** Base URL of the OpenAI-compatible API: `<base>/embeddings`, `<base>/<modelsPath>`. */
  baseUrl: string
  modelsPath: string
  /** Accepts OpenAI's `dimensions` request field (the server cuts the vector itself). */
  dimensionsField: boolean
  /**
   * A sign-in's token is an ordinary API key here (OpenRouter's OAuth issues one). Elsewhere a
   * sign-in is a subscription's (ChatGPT's) and opens no embeddings API: only a key does.
   */
  signInWorks?: boolean
}

export const PROVIDER_EMBEDDINGS: readonly ProviderEmbeddings[] = [
  {
    providerId: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelsPath: 'models',
    dimensionsField: true,
  },
  {
    providerId: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsPath: 'models',
    dimensionsField: true,
  },
  {
    providerId: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsPath: 'models',
    dimensionsField: false,
  },
  {
    providerId: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsPath: 'embeddings/models',
    dimensionsField: true,
    signInWorks: true,
  },
]

export const providerEmbeddingsFor = (providerId: string) =>
  PROVIDER_EMBEDDINGS.find((p) => p.providerId === providerId)

export interface DiscoveredModel {
  model: string
  /** The provider's own display name, less its vendor prefix ("Gemini Embedding 2"). */
  name: string | null
  /** ISO date, when the provider says (OpenAI's `created`). */
  releasedAt: string | null
}

/** The embedding models a provider lists for this key, of known families only. */
export async function discoverProviderModels(
  provider: ProviderEmbeddings,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredModel[]> {
  const response = await fetchImpl(`${provider.baseUrl}/${provider.modelsPath}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`${provider.providerId} models answered ${response.status}`)
  const body = (await response.json()) as {
    data?: Array<{ id: string; name?: string; created?: number }>
  }
  const seen = new Set<string>()
  const out: DiscoveredModel[] = []
  for (const row of body.data ?? []) {
    // Google lists `models/<id>`; the embeddings endpoint takes the bare id.
    const model = row.id.replace(/^models\//, '')
    if (seen.has(model) || !familyOf(model)) continue
    seen.add(model)
    out.push({
      model,
      name: row.name ? row.name.replace(/^[^:]+:\s*/, '').replace(/\s*\(free\)$/i, '') : null,
      releasedAt: row.created ? new Date(row.created * 1000).toISOString().slice(0, 10) : null,
    })
  }
  return out
}
