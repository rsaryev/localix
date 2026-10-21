/**
 * The embedding model, with what makes it an embedding model HERE: its family's prompts, the
 * width the index stores and its chunk size. It runs on this computer (files, download and
 * serving owned by `features/local-models`); there is one — EmbeddingGemma 2 — and no choice.
 *
 * The fingerprint stored beside every vector derives from the model and these fields, so a model
 * changed in code re-embeds rather than mixing two vector spaces in one collection.
 */
import type { SemanticTask } from '@localixai/plugin-sdk/backend'
import type { LocalModelSpec } from '../local-models/contracts'
import { EMBEDDINGGEMMA_2_MODEL } from '../local-models/pinned'
import { familyOf, MATRYOSHKA_INDEX_DIMENSIONS, type EmbeddingFamily } from './families'

export type EmbeddingSource = { kind: 'local'; local: LocalModelSpec }

export interface EmbeddingModelSpec {
  id: string
  label: string
  /** Who made it and under which licence. */
  attribution: string
  source: EmbeddingSource
  releasedAt: string | null
  /** The model's native output width. */
  dimensions: number
  /** Width the index stores (a Matryoshka prefix, re-normalized; else the whole vector). */
  indexDimensions: number
  /** Longest chunk the host hands the model, in characters. */
  maxChunkChars: number
  /** Bumped when the prompts change. Part of the fingerprint. */
  promptVersion: number
  formatQuery(task: SemanticTask, text: string): string
  formatDocument(task: SemanticTask, title: string | undefined, text: string): string
}

function fromFamily(family: EmbeddingFamily, id: string) {
  const dimensions = family.dimensionsOf?.(id) ?? family.dimensions
  return {
    attribution: family.attribution,
    dimensions,
    // A Matryoshka model stores its leading 256 dimensions; any other, the whole vector.
    indexDimensions: family.matryoshka
      ? Math.min(MATRYOSHKA_INDEX_DIMENSIONS, dimensions)
      : dimensions,
    maxChunkChars: family.maxChunkChars,
    promptVersion: family.promptVersion,
    formatQuery: family.formatQuery,
    formatDocument: family.formatDocument,
  }
}

/** A local model as an embedding model, when its family is known. */
export function localEmbeddingModel(local: LocalModelSpec): EmbeddingModelSpec | null {
  const family = local.kind === 'embedding' ? familyOf(local.repo) : undefined
  if (!family) return null
  return {
    id: local.id,
    label: family.name(local.repo),
    source: { kind: 'local', local },
    releasedAt: local.releasedAt ?? null,
    ...fromFamily(family, local.repo),
  }
}

/**
 * EmbeddingGemma 2: text, code, images, video and audio in one 768-wide space, 100+ languages.
 * 256 stored dimensions measure 60.41 on MTEB multilingual against 61.36 at 768, for a third of
 * the memory. The default: it runs here, and nothing leaves the computer.
 */
export const EMBEDDINGGEMMA_2: EmbeddingModelSpec = localEmbeddingModel(EMBEDDINGGEMMA_2_MODEL)!

/** Identity of a vector space: model (and revision), stored width and prompts. */
export function modelFingerprint(model: EmbeddingModelSpec): string {
  const revision = `@${model.source.local.revision.slice(0, 12)}`
  return `${model.id}${revision}/d${model.indexDimensions}/p${model.promptVersion}`
}
