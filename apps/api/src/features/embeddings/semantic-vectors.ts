/**
 * Vectors on demand — the ONE way anything in Localix gets vectors: semantic search's queries
 * (`semantic-index.ts`), group routing, plugins (`host.semantic.embed`/`rank`), and whatever comes
 * next. The semantic service builds one and hands it out as `service.vectors`.
 *
 * No consumer names the model, keeps its own cosine or reaches into the engine: the model is chosen
 * in `models.ts` and its prompts in `families.ts`, so changing it rewrites no consumer. Results
 * carry the model's fingerprint for a consumer that stores vectors. Null whenever search answers
 * from words (model downloading, engine parked): the consumer falls back to its own way.
 */
import type {
  SemanticCandidate,
  SemanticTask,
  SemanticVectors,
} from '@localixai/mini-app-sdk/backend'
import type { SearchStrategyNote } from './contracts'
import type { EmbeddingEngine } from './engine'

/**
 * Tasks whose prompt is the same on both sides (`families.ts`). Their candidates go through the
 * query path: cached, and never queued behind indexing in the document lane.
 */
const SYMMETRIC_TASKS: ReadonlySet<SemanticTask> = new Set(['similarity', 'classification'])

/** Vectors are L2-normalized by the engine, so this is the dot product with a guard. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na * nb) || 1)
}

export function createSemanticVectors(service: {
  strategy(): SearchStrategyNote
  /** The engine search may use right now, or null. */
  engine(): EmbeddingEngine | null
}): SemanticVectors {
  const engine = () => (service.strategy().mode === 'hybrid' ? service.engine() : null)

  return {
    ready() {
      const running = engine()
      return running
        ? { model: running.fingerprint, dimensions: running.model.indexDimensions }
        : null
    },

    async embed(texts, options) {
      const running = engine()
      if (!running) return null
      const task = options.task ?? 'search'
      const vectors =
        options.role === 'query'
          ? await Promise.all(texts.map((text) => running.embedQuery(text, task)))
          : await running.embedDocuments(texts.map((text) => ({ text, task })))
      return { model: running.fingerprint, dimensions: running.model.indexDimensions, vectors }
    },

    async rank(query, candidates: readonly SemanticCandidate[], options) {
      const running = engine()
      if (!running) return null
      const task = options?.task ?? 'similarity'
      const texts = candidates.map((candidate) => candidate.text)
      const [asked, vectors] = await Promise.all([
        running.embedQuery(query, task),
        SYMMETRIC_TASKS.has(task)
          ? Promise.all(texts.map((text) => running.embedQuery(text, task)))
          : running.embedDocuments(texts.map((text) => ({ text, task }))),
      ])
      const ranked = candidates
        .map((candidate, i) => ({ key: candidate.key, cosine: cosine(asked, vectors[i]!) }))
        .sort((a, b) => b.cosine - a.cosine)
      return { model: running.fingerprint, ranked }
    },
  }
}
