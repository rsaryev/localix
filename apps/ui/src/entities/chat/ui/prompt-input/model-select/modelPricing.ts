import type { CatalogModel } from '@localixai/agent/catalog'

type ModelCost = NonNullable<CatalogModel['cost']>

/** Catalog adapters use negative sentinel rates when a router cannot know its price up front. */
export function hasKnownTokenPricing(cost: CatalogModel['cost']): cost is ModelCost {
  return (
    cost !== undefined &&
    Number.isFinite(cost.input) &&
    Number.isFinite(cost.output) &&
    cost.input >= 0 &&
    cost.output >= 0
  )
}

export function formatTokenPrice(usdPerMillion: number): string {
  if (!Number.isFinite(usdPerMillion) || usdPerMillion < 0) return '—'
  if (usdPerMillion === 0) return 'Free'
  if (usdPerMillion < 0.001) return `$${(usdPerMillion * 1000).toFixed(3)}/B`
  return `$${usdPerMillion.toFixed(2)}`
}
