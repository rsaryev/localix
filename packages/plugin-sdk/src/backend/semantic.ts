/**
 * SEMANTIC INDEX — the embedding seam the host offers to search providers and plugins.
 *
 * One mechanism, three consumers. The host runs ONE embedding engine (a local model by
 * default) and keeps ONE vector store. A producer never computes or stores vectors itself:
 * it describes its items as a {@link SemanticSource} (pull: the host pages through them on
 * first enable, on a model change, and again for the keys it is told changed), and asks
 * questions through a {@link SemanticQuery} (the search strategy of one query) or a
 * collection's `query`.
 *
 * Why pull and not push. A push API drops everything written while semantic search was off,
 * and every model change would need every producer to replay its data. A source that can be
 * scanned is re-indexed by the host alone: enabling the feature, swapping the model or
 * bumping a source's `version` re-embeds exactly what changed (items carry a content hash).
 *
 * Why a z-score. Cosine similarity has no absolute meaning: with one model "unrelated" sits
 * around 0.6. Every vector of a collection is scored anyway, so the host standardizes the
 * scores per query and a match counts only when it stands out (`z >= zGate`). That is what
 * lets a search honestly answer "no good matches" instead of always returning a top ten.
 */

/**
 * The `scope` of an item available everywhere (a global capability), beside items scoped to one
 * project: a query for a project asks for `[SEMANTIC_GLOBAL_SCOPE, projectId]`.
 */
export const SEMANTIC_GLOBAL_SCOPE = 'global'

/** What the embedding is for — picks the model's task prompt. */
export type SemanticTask = 'search' | 'question' | 'code' | 'similarity' | 'classification'

/** One item a source hands to the index. Text is embedded as a document. */
export interface SemanticSourceItem {
  /** Stable key within the collection — the producer's own id (message id, card id…). */
  key: string
  /** Owner. The index never answers one user's query with another user's items. */
  userId: string
  /** The text to embed. Long text is chunked by the host. Empty text removes the item. */
  text: string
  /** Optional heading the model sees with every chunk (`title: … | text: …`). */
  title?: string
  /** One filter value queries may restrict to (a project id, a board id). */
  scope?: string | null
  /**
   * The key of the item this one belongs to (a message's chat), when deleting that one deletes
   * this one too: the host removes every item under a deleted parent without a key per child.
   */
  parent?: string | null
  /** Task the item is retrieved for. Default `search`. */
  task?: SemanticTask
}

/** A page of a full scan. `next: null` ends the scan. */
export interface SemanticSourcePage {
  items: SemanticSourceItem[]
  next: string | null
}

/**
 * A producer's items, readable by the host. Registered once; the host decides when to read.
 *
 * `scan` walks every item (backfill and reconcile); `read` answers for the keys the producer
 * reported changed. A key `read` does not return is treated as deleted.
 */
export interface SemanticSource {
  /** Collection name. A plugin's names are namespaced by the host (`plugin:<name>:<collection>`). */
  collection: string
  /** What a person calls these items (`Messages`, `Cards`), where the index lists its categories. */
  label?: string
  /** Bump to re-embed every item, e.g. after changing what `text` contains. */
  version: number
  scan(cursor: string | null, limit: number): Promise<SemanticSourcePage>
  read(keys: string[]): Promise<SemanticSourceItem[]>
  /** How many items a full scan will visit — only for the progress bar. */
  count?(): Promise<number>
}

/** One stored chunk that matched a query. */
export interface SemanticMatch {
  key: string
  /** Which chunk of the item matched (0 for short items). */
  chunk: number
  /** The chunk's text, as embedded (without the task prompt). */
  excerpt: string
  /** Standardized score for THIS query against the whole collection of this user. */
  z: number
  /**
   * The z this collection's matches must reach to count as standing out. It grows with the
   * collection: the best of N unrelated items is itself near √(2·ln N) deviations above the mean,
   * so a fixed gate would always pass the top of the noise.
   */
  gate: number
  cosine: number
  scope: string | null
}

export interface SemanticSimilarOptions {
  /** Best chunk per item, at most this many items. Default 50. */
  limit?: number
  /** Only items with one of these scope values. */
  scope?: string | readonly string[]
  /** Minimum z. Default: no minimum — callers fuse and gate themselves. */
  minZ?: number
}

/**
 * The semantic half of one search query. Present on a `SearchQuery` only when the person
 * turned semantic search on AND the engine can answer; absent means the lexical strategy.
 * The query text is embedded once and shared by every provider that asks.
 */
export interface SemanticQuery {
  /** The floor of every collection's `gate` (small collections use it as is). */
  readonly zGate: number
  /**
   * True when the query's vector was not ready within its budget (the model was still loading):
   * `similar` then answered empty and this search was effectively words only.
   */
  readonly missed?: boolean
  similar(collection: string, options?: SemanticSimilarOptions): Promise<SemanticMatch[]>
}

/** Where the index stands, for a plugin deciding whether to offer meaning-based features. */
export interface SemanticIndexStatus {
  enabled: boolean
  ready: boolean
  model: { id: string; label: string; dimensions: number } | null
}

/** The host capability a plugin backend receives as `host.semantic`. */
export interface SemanticIndexHost {
  status(): SemanticIndexStatus
  /** Register a source of the plugin's own items. Returns the unregister disposer. */
  registerSource(source: SemanticSource): () => void
  /** Tell the host these keys of the plugin's collection changed (or were deleted). */
  changed(collection: string, keys: readonly string[]): void
  /** Query one of the plugin's own collections. Empty when semantic search is off. */
  query(
    userId: string,
    collection: string,
    text: string,
    options?: SemanticSimilarOptions & { task?: SemanticTask },
  ): Promise<SemanticMatch[]>
  /** Raw vectors, for a plugin that needs them (clustering, dedupe). Null when off. */
  embed(
    texts: readonly string[],
    options: { role: 'query' | 'document'; task?: SemanticTask },
  ): Promise<{ model: string; dimensions: number; vectors: Float32Array[] } | null>
}
