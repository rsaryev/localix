import type { CatalogModel, ModelKind } from './types'

/** A model's kind, with absence read as chat (what every runtime adapter lists). */
export const modelKindOf = (model: Pick<CatalogModel, 'kind'>): ModelKind => model.kind ?? 'chat'

/** Providers that run on this computer (the host's `local` provider). They lead every list. */
export const ON_DEVICE_PROVIDER_IDS: ReadonlySet<string> = new Set(['local'])

/** On-device providers first, source order kept within each band. */
export function onDeviceFirst<T>(
  providers: readonly T[],
  providerId: (provider: T) => string,
): T[] {
  return [...providers].sort(
    (left, right) =>
      Number(ON_DEVICE_PROVIDER_IDS.has(providerId(right))) -
      Number(ON_DEVICE_PROVIDER_IDS.has(providerId(left))),
  )
}

/**
 * The providers people use most, most used first: the first-party labs and their subscriptions,
 * the routers and clouds most keys come from, then the inference hosts. models.dev carries no
 * usage figures, so this is curated; a provider it does not name follows, alphabetically.
 */
export const POPULAR_PROVIDER_IDS: readonly string[] = [
  'openai',
  'openai-codex',
  'anthropic',
  'google',
  'openrouter',
  'github-copilot',
  'xai',
  'deepseek',
  'mistral',
  'amazon-bedrock',
  'azure',
  'google-vertex',
  'google-vertex-anthropic',
  'vercel',
  'groq',
  'moonshotai',
  'zai',
  'alibaba',
  'minimax',
  'togetherai',
  'fireworks-ai',
  'cerebras',
  'perplexity-agent',
  'cohere',
  'huggingface',
  'deepinfra',
  'ollama-cloud',
  'lmstudio',
  'nvidia',
  'opencode',
  'cloudflare-workers-ai',
  'cloudflare-ai-gateway',
  'sambanova',
  'novita-ai',
  'nebius',
  'siliconflow',
  'baseten',
]

const POPULARITY: ReadonlyMap<string, number> = new Map(
  POPULAR_PROVIDER_IDS.map((id, rank) => [id, rank]),
)

/**
 * Sort provider-like values for display: on-device providers first, then the popular ones in
 * {@link POPULAR_PROVIDER_IDS} order, then the rest by id. Entries of one provider (several
 * connections) keep their source order.
 */
export function sortProvidersByPopularity<T>(
  providers: readonly T[],
  providerId: (provider: T) => string,
): T[] {
  const rank = (id: string) =>
    ON_DEVICE_PROVIDER_IDS.has(id) ? -1 : (POPULARITY.get(id) ?? POPULAR_PROVIDER_IDS.length)
  return [...providers].sort((left, right) => {
    const a = providerId(left)
    const b = providerId(right)
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0)
  })
}

function releaseTimestamp(model: CatalogModel): number | undefined {
  const value = model.releaseDate?.trim()
  if (!value) return undefined

  // Runtime adapters own this metadata and currently emit RFC 3339/ISO 8601.
  // `Date.parse` alone is deliberately permissive (`2025`, `01/02/03`, and even
  // some impossible calendar dates are accepted differently across engines),
  // which would let malformed plugin metadata reorder the shared model catalog.
  // Require an unambiguous calendar date, optionally followed by an ISO time and
  // explicit timezone, before asking the engine for its timestamp.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value)
  if (!match) return undefined
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined

  // Date parsing may normalize an impossible date (for example February 30)
  // into the following month. Verify the source calendar components explicitly.
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarProbe = new Date(Date.UTC(year, month - 1, day))
  return calendarProbe.getUTCFullYear() === year &&
    calendarProbe.getUTCMonth() === month - 1 &&
    calendarProbe.getUTCDate() === day
    ? timestamp
    : undefined
}

/**
 * Newest dated models first. Equal-date and undated models retain the runtime
 * adapter's authoritative source order. A model id is an opaque provider key,
 * not release metadata: lexical/numeric guesses break on aliases (`latest`),
 * dated suffixes, custom gateways, and colliding ids from different providers.
 */
export function compareCatalogModelsNewestFirst(left: CatalogModel, right: CatalogModel): number {
  const leftTimestamp = releaseTimestamp(left)
  const rightTimestamp = releaseTimestamp(right)

  if (leftTimestamp !== undefined && rightTimestamp === undefined) return -1
  if (leftTimestamp === undefined && rightTimestamp !== undefined) return 1
  if (
    leftTimestamp !== undefined &&
    rightTimestamp !== undefined &&
    leftTimestamp !== rightTimestamp
  ) {
    return rightTimestamp - leftTimestamp
  }

  return 0
}

/** Return a sorted copy; runtime-owned catalog arrays are never mutated. */
export function sortCatalogModelsNewestFirst(models: readonly CatalogModel[]): CatalogModel[] {
  return [...models].sort(compareCatalogModelsNewestFirst)
}
