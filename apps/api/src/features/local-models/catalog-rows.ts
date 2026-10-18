/**
 * Which Hugging Face rows the catalog is built from. The list is the labs' own models, the most
 * downloaded GGUF builds of them (`publishers.ts`); anything else is added by its id — one or two
 * requests each, cached by `listings`.
 * Embedding models come from the llama.cpp project's embedding conversions, where semantic
 * search's model families live.
 */
import { isChatCandidate, uniqueRows } from './candidates'
import { kindOf } from './hf-catalog'
import { DEFAULT_PUBLISHER, type HfModel } from './hf-client'
import type { Listings } from './listings'
import { CONVERTERS, isOriginalModel, originalKey } from './publishers'

/** The most downloaded GGUF repositories, where the labs' models are found (one page). */
const POPULAR_SIZE = 1000
/** Models listed before a search. */
const CATALOG_SIZE = 100
const SEARCH_SIZE = 50
/** Builds offered for an original no trusted converter published: the most downloaded few. */
const LOOKUP_UNTRUSTED = 5
/** `owner/model`: a Hugging Face model id. */
const REPO_ID = /^[\w.-]+\/[\w.-]+$/
/** The family recommended for chat: Gemma 4's instruction-tuned models. */
const RECOMMENDED_SEARCH = 'gemma-4'
/** Who builds it: Google's own quantization-aware builds, then the trusted converters'. */
const RECOMMENDED_PUBLISHERS = ['google', ...CONVERTERS] as const
/** One of Gemma 4's sizes, instruction-tuned, as the original: not a fine-tune or a variant. */
const RECOMMENDED_ORIGINAL = /^google\/gemma-4-(e\d+b|\d+b(-a\d+b)?)-it$/
/** A build's own name: the original's, with its owner's prefix and build words at most. */
const RECOMMENDED_BUILD = /^(google_)?gemma-4-(e\d+b|\d+b(-a\d+b)?)-it(-qat)?(-q4_0)?(-gguf)?$/i
/** Pipelines embedding repositories are tagged with. */
const EMBEDDING_PIPELINES = ['feature-extraction', 'sentence-similarity'] as const

export function createCatalogRows(listings: Listings) {
  return {
    /**
     * The labs' most downloaded chat models: the hundred most downloaded originals, with every
     * trusted build of each — which build is listed depends on this computer (`catalog.ts`
     * keeps the one that runs here best).
     */
    async browse(): Promise<HfModel[]> {
      const rows = await listings.browse('popular', { limit: POPULAR_SIZE })
      const builds = uniqueRows(rows).filter((r) => isOriginalModel(r) && isChatCandidate(r))
      const kept = new Set([...new Set(builds.map(originalKey))].slice(0, CATALOG_SIZE))
      return builds.filter((row) => kept.has(originalKey(row)))
    },

    /**
     * A model added by its Hugging Face id (`Qwen/Qwen3.8-Flash-Next`). A GGUF repository's id
     * is that repository; an original model's id finds its GGUF builds — the trusted converters'
     * when there are any, else the most downloaded few.
     */
    async lookup(id: string): Promise<HfModel[]> {
      if (!REPO_ID.test(id)) return []
      const [owner, name] = id.split('/') as [string, string]
      const [builds, own] = await Promise.all([
        listings.search({ quantizationOf: id, limit: SEARCH_SIZE }),
        listings.search({ author: owner, search: name, limit: SEARCH_SIZE }),
      ])
      const exact = own.filter((row) => row.id.toLowerCase() === id.toLowerCase())
      if (exact.some((row) => (row.siblings ?? []).some((f) => f.rfilename.endsWith('.gguf')))) {
        return exact
      }
      // Chat and embedding models alike: an id names the model, whatever its job.
      const all = uniqueRows(builds).filter(
        (row) => isChatCandidate(row) || kindOf(row.pipeline_tag, row.id) === 'embedding',
      )
      const trusted = all.filter(isOriginalModel)
      return trusted.length > 0 ? trusted : all.slice(0, LOOKUP_UNTRUSTED)
    },

    /**
     * Gemma 4 in every size and width: Google's own quantization-aware Q4_0 builds and the
     * trusted converters' quantizations of the same originals. Which one is recommended
     * depends on this computer and the person's preference (`recommend.ts`).
     */
    async recommended(): Promise<HfModel[]> {
      const pages = await Promise.all(
        RECOMMENDED_PUBLISHERS.map((author) =>
          listings.browse(`recommended:${author}`, {
            author,
            search: RECOMMENDED_SEARCH,
            limit: SEARCH_SIZE,
          }),
        ),
      )
      return uniqueRows(pages.flat()).filter(
        (row) =>
          isOriginalModel(row) &&
          isChatCandidate(row) &&
          RECOMMENDED_ORIGINAL.test(originalKey(row)) &&
          RECOMMENDED_BUILD.test(row.id.split('/')[1] ?? ''),
      )
    },

    /** Embedding repositories, from the llama.cpp project's listings. */
    async embeddings(): Promise<HfModel[]> {
      const pages = await Promise.all([
        ...EMBEDDING_PIPELINES.map((pipeline) =>
          listings.browse(`embedding:${pipeline}`, {
            author: DEFAULT_PUBLISHER,
            pipeline,
            limit: SEARCH_SIZE,
          }),
        ),
        listings.browse('embedding:named', {
          author: DEFAULT_PUBLISHER,
          search: 'embed',
          limit: SEARCH_SIZE,
        }),
      ])
      return uniqueRows(pages.flat())
    },
  }
}
