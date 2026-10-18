/**
 * The embedding backend over the local-models router: `/v1/embeddings` with the model id the
 * router routes by. The router owns the process (start, idle stop, model load), so stopping this
 * backend releases nothing — another consumer may be using the same server.
 */
import type { ModelRouter } from '../local-models/router'
import type { EmbeddingBackend } from './engine'

export function routerEmbeddingBackend(
  router: Pick<ModelRouter, 'ensure'>,
  modelId: string,
): EmbeddingBackend {
  return {
    running: true,
    async embed(inputs, signal) {
      const server = await router.ensure()
      const response = await server.request('/v1/embeddings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelId, input: inputs, encoding_format: 'float' }),
        signal,
      })
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300)
        throw new Error(`embedding request failed (${response.status}): ${detail}`)
      }
      const body = (await response.json()) as {
        data?: Array<{ index: number; embedding: number[] }>
      }
      const data = body.data ?? []
      if (data.length !== inputs.length) {
        throw new Error(
          `embedding server returned ${data.length} vectors for ${inputs.length} inputs`,
        )
      }
      return [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
    },
    async stop() {},
  }
}
