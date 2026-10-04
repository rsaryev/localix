import type { CatalogModel } from '@localixai/agent/catalog'

/** Capability facets a user can narrow the model list by (multi-select, AND). */
export type ModelFilter = 'tools' | 'reasoning' | 'vision' | 'caching' | 'free'

/**
 * One predicate per facet. `vision` = accepts image input; `free` = a known zero cost (a model
 * with unknown cost is NOT assumed free); `caching` = the provider PRICES prompt caching, which
 * for a long agent run is the difference between a session that stays affordable and one that
 * does not — the cost of re-sending the same prefix every turn is the bill. There is no
 * image/video facet: the catalog carries text models only.
 */
const MODEL_FILTER_PREDICATES: Record<ModelFilter, (m: CatalogModel) => boolean> = {
  tools: (m) => m.supportsTools,
  reasoning: (m) => m.supportsReasoning,
  vision: (m) => m.inputModalities.includes('image'),
  caching: (m) => !!m.cost && ((m.cost.cacheRead ?? 0) > 0 || (m.cost.cacheWrite ?? 0) > 0),
  free: (m) => !!m.cost && m.cost.input === 0 && m.cost.output === 0,
}

/** Stable display order for the filter pills. */
export const MODEL_FILTER_ORDER: ModelFilter[] = ['tools', 'reasoning', 'vision', 'caching', 'free']

/**
 * The model list shown for a selected connection, pure and dependency-free so it
 * can be unit-tested in isolation.
 *
 * - The runtime-owned catalog is narrowed to the connection's provider. It used
 *   to drop image/video OUTPUT models too, which the adapter merged in beside the
 *   chat models; the adapter no longer lists them at all.
 * - A search query (case-insensitive) matches the model's name, its id, or the levels it
 *   reasons at — so "xhigh" finds the models that can be asked for it.
 * - Capability filters narrow further (AND across all active facets).
 */
export function filterModels(
  catalogModels: CatalogModel[],
  providerId: string | null | undefined,
  search: string,
  filters: readonly ModelFilter[] = [],
): CatalogModel[] {
  if (!providerId) return []
  let result = catalogModels.filter((model) => model.providerId === providerId)
  const q = search.trim().toLowerCase()
  if (q)
    result = result.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.reasoningEfforts?.some((level) => level.toLowerCase() === q) ?? false),
    )
  for (const f of filters) result = result.filter(MODEL_FILTER_PREDICATES[f])
  return result
}

/**
 * Which filter facets are worth showing for a list — a facet only appears when at
 * least one model in the (unfiltered) list matches it, so the menu never offers
 * a control that would just empty the list.
 */
export function availableModelFilters(models: CatalogModel[]): ModelFilter[] {
  return MODEL_FILTER_ORDER.filter((f) => models.some(MODEL_FILTER_PREDICATES[f]))
}

/**
 * The model column's count: "12", or "4 of 12" once search or a filter hides some. Filters
 * live behind one menu button, so this is what says the list is narrower than the connection.
 */
export function modelCountLabel(shown: number, total: number): string {
  return shown === total ? String(total) : `${shown} of ${total}`
}
