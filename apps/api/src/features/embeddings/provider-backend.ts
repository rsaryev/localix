/**
 * The embedding backend over a cloud provider's OpenAI-compatible `/embeddings` endpoint, with
 * the API key of the person who chose the model (resolved per request, so a rotated key keeps
 * working). Vectors come back at the stored width when the provider can cut them itself.
 */
import type { EmbeddingBackend } from './engine'
import type { EmbeddingModelSpec } from './models'

const TIMEOUT_MS = 30_000

export function providerEmbeddingBackend(
  model: EmbeddingModelSpec,
  apiKey: () => Promise<string | null>,
  fetchImpl: typeof fetch = fetch,
): EmbeddingBackend {
  if (model.source.kind !== 'provider') throw new Error(`${model.id} is not a provider model`)
  const { baseUrl, model: name, dimensionsField } = model.source
  return {
    running: true,
    async embed(inputs, signal) {
      const key = await apiKey()
      if (!key) {
        throw new Error(`No API key for ${model.label}: connect its provider with an API key`)
      }
      const response = await fetchImpl(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: name,
          input: inputs,
          encoding_format: 'float',
          ...(dimensionsField && model.indexDimensions < model.dimensions
            ? { dimensions: model.indexDimensions }
            : {}),
        }),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
          : AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300)
        throw new Error(`${model.label} answered ${response.status}: ${detail}`)
      }
      const body = (await response.json()) as {
        data?: Array<{ index: number; embedding: number[] }>
      }
      const data = body.data ?? []
      if (data.length !== inputs.length) {
        throw new Error(
          `${model.label} returned ${data.length} vectors for ${inputs.length} inputs`,
        )
      }
      return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
    },
    async stop() {},
  }
}
