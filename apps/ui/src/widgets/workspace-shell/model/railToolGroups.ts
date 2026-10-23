import type { MiniAppCategory } from '@localixai/mini-app-sdk/manifest'
import type { RailEntry } from '../ui/shellTypes'

export type RailToolCategory = 'workspace' | 'tools' | 'games'
export const RAIL_CATEGORY_LABELS: Record<RailToolCategory, string> = {
  workspace: 'Workspace',
  tools: 'Tools',
  games: 'Games',
}

/** Catalog membership is independent of mini app ownership. */
export function isRailTool(entry: RailEntry): boolean {
  return entry.miniApp === true || entry.toolCategory !== undefined
}

export function railToolCategoryFor(
  entry: RailEntry,
  categories?: ReadonlyMap<string, MiniAppCategory | undefined>,
): RailToolCategory {
  const category =
    entry.toolCategory ?? (entry.miniAppName ? categories?.get(entry.miniAppName) : undefined)
  if (category === 'games') return 'games'
  return category === 'development' || category === 'data' || category === 'content'
    ? 'workspace'
    : 'tools'
}

/** The launcher and rail use the same manifest categories and stable display order. */
export function groupRailTools(
  entries: readonly RailEntry[],
  categories?: ReadonlyMap<string, MiniAppCategory | undefined>,
) {
  const buckets = new Map<RailToolCategory, RailEntry[]>()
  for (const entry of entries) {
    const category = railToolCategoryFor(entry, categories)
    const bucket = buckets.get(category) ?? []
    bucket.push(entry)
    buckets.set(category, bucket)
  }
  return (['workspace', 'tools', 'games'] as const).flatMap((category) => {
    const items = buckets.get(category)
    return items?.length
      ? [{ category, label: RAIL_CATEGORY_LABELS[category], entries: items }]
      : []
  })
}
