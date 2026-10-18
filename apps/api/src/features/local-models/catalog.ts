/**
 * The local-model catalog, for Settings → Models: the labs' most downloaded models as GGUF
 * (`catalog-rows`), or a model added by its Hugging Face id — each judged for this computer:
 * whether it runs here, at which variant and context, about how fast. The `local` provider lists
 * only what is installed (the service plans those from their own files). Nothing is listed in
 * code but the embedding model semantic search is pinned to, and the family recommended first
 * (Gemma 4, at the size that suits this computer).
 *
 * Built to ask Hugging Face as little as possible, in layers:
 *   - a list is ONE request (`catalog-rows`, cached by `listings`): cards come from it with
 *     estimated sizes;
 *   - exact files and hashes are read per repository only to show a model in detail or install
 *     it (`exact-specs`), and then replace the estimates on its card;
 *   - model shapes (what sizes the attention cache) are learned in the background, once ever,
 *     and plan the next read better (`shapes`).
 * An installed model's own manifest always wins: it is the revision actually on disk.
 */
import { buildEntries, planFor, sortEntries, type CatalogGroup } from './catalog-rank'
import { createCatalogRows } from './catalog-rows'
import { isChatCandidate, withConsistentParameters, withoutPretrainedTwins } from './candidates'
import type { LocalModelEntry, LocalModelKind, LocalModelSpec } from './contracts'
import { createDrafterFinder } from './drafters'
import { createExactSpecs } from './exact-specs'
import { estimatedSpecs } from './hf-catalog'
import type { HfClient, HfModel } from './hf-client'
import { createListings } from './listings'
import type { MachineProfile } from './machine'
import { EMBEDDINGGEMMA_2_MODEL, PINNED_MODELS } from './pinned'
import { originalKey, publisherRank } from './publishers'
import { recommendOptions } from './recommend'
import { createShapeCache, type ShapeCache } from './shapes'

/** Smaller than this is a test fixture, not a model to talk to. */
const MIN_PARAMETERS = 0.25e9
/** An embedding variant: Q8_0 keeps its vectors faithful; full precision is not offered. */
const EMBEDDING_VARIANTS = ['Q8_0', 'Q4_0', 'Q4_K_M']
const FIT_RANK = { good: 0, tight: 1, 'too-large': 2 } as const

export interface CatalogQuery {
  /** A Hugging Face model id to add (`Qwen/Qwen3.8-Flash-Next`); absent, the curated list. */
  id?: string
  kind?: LocalModelKind
}

/**
 * One entry per original model: the build that runs here best (Qwen3.8-27B from whoever ships a
 * variant that fits, not a converter whose smallest does not), the preferred publisher on a tie.
 */
function bestBuilds(entries: readonly LocalModelEntry[]): LocalModelEntry[] {
  const keyOf = (e: LocalModelEntry) =>
    originalKey({ id: e.spec.repo, cardData: { base_model: e.spec.baseModel ?? undefined } })
  const rank = (e: LocalModelEntry) =>
    [Number(!e.installed), FIT_RANK[e.plan?.fit ?? 'good'], publisherRank(e.spec.repo)] as const
  const better = (a: LocalModelEntry, b: LocalModelEntry) => {
    const [x, y] = [rank(a), rank(b)]
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  }
  const best = new Map<string, LocalModelEntry>()
  for (const entry of entries) {
    const held = best.get(keyOf(entry))
    if (!held || better(entry, held) < 0) best.set(keyOf(entry), entry)
  }
  return [...best.values()]
}

export function createLocalCatalog(deps: {
  root: string
  hf: HfClient
  installed: () => readonly LocalModelSpec[]
  machine: () => MachineProfile | null
  shapes?: ShapeCache
  log?: (event: string, fields: Record<string, unknown>) => void
  now?: () => number
}) {
  const shapes = deps.shapes ?? createShapeCache({ root: deps.root })
  const listings = createListings({ root: deps.root, hf: deps.hf, log: deps.log, now: deps.now })
  const rows = createCatalogRows(listings)
  const exact = createExactSpecs({ root: deps.root, hf: deps.hf, drafters: () => drafters })
  const drafters = createDrafterFinder({ hf: deps.hf, repo: exact.info, now: deps.now })
  let draftFor: (repo: string) => LocalModelSpec['draft'] = () => null
  let refining: Promise<void> | null = null

  /** A list row as a catalog group: exact specs when stored at its commit, else estimates. */
  function groupOf(row: HfModel, kind: LocalModelKind): CatalogGroup | null {
    const stored = exact.peek(row.id, row.sha)
    const specs = (stored?.specs ?? estimatedSpecs(row))
      .filter((s) => s.kind === kind && (s.parameters ?? MIN_PARAMETERS) >= MIN_PARAMETERS)
      .map((s) => ({ ...s, draft: s.draft ?? draftFor(row.id) ?? null }))
    if (specs.length === 0) return null
    return { repo: row.id, specs, downloads: row.downloads ?? null, exact: !!stored }
  }

  const chatGroups = (list: readonly HfModel[]) =>
    withoutPretrainedTwins(
      withConsistentParameters(list)
        .filter(isChatCandidate)
        .map((row) => groupOf(row, 'chat'))
        .filter((g): g is CatalogGroup => g !== null),
    )

  const judge = (groups: readonly CatalogGroup[]) =>
    buildEntries({
      groups,
      installed: deps.installed(),
      machine: deps.machine(),
      shapeOf: (spec) => shapes.get(spec),
    })

  /** Learn model shapes in the background; the next read plans with them. */
  function refine(groups: readonly CatalogGroup[]) {
    if (refining) return
    refining = shapes
      .ensure(groups.map((g) => g.specs[0]!))
      .catch(() => {})
      .finally(() => {
        refining = null
      })
  }

  /** Rows that hold an embedding model, one variant each (Q8_0 first), not planned for chat. */
  function embeddingsOf(found: readonly HfModel[]): LocalModelEntry[] {
    const installed = deps.installed()
    return found.flatMap((row): LocalModelEntry[] => {
      const specs = groupOf(row, 'embedding')?.specs ?? []
      const spec =
        PINNED_MODELS.find((p) => p.repo === row.id) ??
        installed.find((s) => s.repo === row.id) ??
        EMBEDDING_VARIANTS.map((v) => specs.find((s) => s.variant.toUpperCase() === v)).find(
          Boolean,
        )
      if (!spec) return []
      return [
        {
          spec,
          installed: installed.some((s) => s.id === spec.id),
          featured: false,
          plan: null,
          downloads: row.downloads ?? null,
          variants: [],
          exact: spec.files.every((f) => !!f.sha256),
        },
      ]
    })
  }

  /** Embedding repositories, one variant each, the pinned model in place of its floating copy. */
  async function embeddingEntries(): Promise<LocalModelEntry[]> {
    const pinned = (e: LocalModelEntry) => PINNED_MODELS.some((p) => p.id === e.spec.id)
    return sortEntries(
      embeddingsOf(await rows.embeddings()).map((e) => ({ ...e, featured: pinned(e) })),
    )
  }

  /** Every Gemma 4 build that runs here, scored for the speed-or-quality preference. */
  async function recommendedChat(): Promise<LocalModelEntry[]> {
    const groups = chatGroups(await rows.recommended())
    refine(groups)
    return recommendOptions({
      groups,
      installed: deps.installed(),
      machine: deps.machine(),
      shapeOf: (spec) => shapes.get(spec),
    })
  }

  /** Semantic search's own model, pinned in code: no request needed. */
  function recommendedEmbedding(): LocalModelEntry {
    const spec = EMBEDDINGGEMMA_2_MODEL
    return {
      spec,
      installed: deps.installed().some((s) => s.id === spec.id),
      featured: true,
      plan: null,
      downloads: null,
      variants: [],
      exact: true,
    }
  }

  return {
    /**
     * What to get first, mapped to this computer: every Gemma 4 build that runs here, scored
     * (Settings ranks them by the person's preference), and the embedding model semantic
     * search is built on. All are the labs' originals.
     */
    async recommended(): Promise<LocalModelEntry[]> {
      await Promise.all([shapes.restore(), exact.restore()])
      draftFor = await drafters.lookup().catch(() => draftFor)
      const chat = await recommendedChat().catch(() => [])
      return [...chat, recommendedEmbedding()]
    },

    /**
     * The curated list (newest first, the build that runs here for each), or the GGUF builds of
     * a model added by its id, in Hugging Face's order.
     */
    async list(options: CatalogQuery = {}): Promise<LocalModelEntry[]> {
      await Promise.all([shapes.restore(), exact.restore()])
      if (options.kind === 'embedding') return embeddingEntries()
      draftFor = await drafters.lookup().catch(() => draftFor)
      const id = options.id?.trim()
      const found = id ? await rows.lookup(id) : await rows.browse()
      const groups = chatGroups(found)
      refine(groups)
      const entries = judge(groups)
      if (!id) return sortEntries(bestBuilds(entries), { newest: true })
      return sortEntries([...entries, ...embeddingsOf(found)])
    },

    /** One model with its exact files and hashes (the details panel), planned for here. */
    async details(modelId: string): Promise<LocalModelEntry | null> {
      const repo = modelId.slice(0, modelId.lastIndexOf(':'))
      const read = await exact.get(repo)
      const asked = read?.specs.find((s) => s.id === modelId)
      if (!read || !asked) return null
      const [entry] = judge([{ repo, specs: read.specs, downloads: null, exact: true }])
      if (!entry) return null
      const machine = deps.machine()
      // The variant asked for, not the one a pick would choose; planning is for chat models.
      return {
        ...entry,
        spec: asked,
        plan: machine && asked.kind === 'chat' ? planFor(asked, machine, shapes.get(asked)) : null,
      }
    },

    /** A spec by id: installed, pinned, or the exact one from its repository. */
    async resolve(modelId: string): Promise<LocalModelSpec | null> {
      return deps.installed().find((s) => s.id === modelId) ?? this.latest(modelId)
    },

    /** The exact current spec for an id — newer than an installed one when files were added. */
    async latest(modelId: string): Promise<LocalModelSpec | null> {
      const pinned = PINNED_MODELS.find((s) => s.id === modelId)
      if (pinned) return pinned
      const repo = modelId.slice(0, modelId.lastIndexOf(':'))
      if (!repo) return null
      return (await exact.get(repo))?.specs.find((s) => s.id === modelId) ?? null
    },

    /** Write pending caches (shutdown). */
    flush: () => Promise.all([listings.flush(), exact.flush()]),

    /** Test seam: store one repository's exact specs. */
    seed: exact.seed,
  }
}

export type LocalCatalog = ReturnType<typeof createLocalCatalog>
