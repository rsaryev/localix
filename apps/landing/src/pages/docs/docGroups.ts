import type { DocPage } from '../../generated/docs'

// The public manifest owns category assignment; this list controls display order.
const FEATURE_CAT_ORDER = [
  'Core',
  'Workspace',
  'Workbenches',
  'Media',
  'Models & context',
  'Memory & skills',
  'Integrations',
  'More',
] as const
type FeatureCategory = (typeof FEATURE_CAT_ORDER)[number]

export function featureCategoryFor(page: DocPage): FeatureCategory {
  return FEATURE_CAT_ORDER.includes(page.category as FeatureCategory)
    ? (page.category as FeatureCategory)
    : 'More'
}

export function groupByCategory(pages: DocPage[]) {
  const map = new Map<FeatureCategory, DocPage[]>()
  for (const p of pages) {
    const cat = featureCategoryFor(p)
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(p)
  }
  return FEATURE_CAT_ORDER.flatMap((c) => (map.has(c) ? [{ title: c, pages: map.get(c)! }] : []))
}

export function groupBySection(pages: DocPage[]) {
  const map = new Map<string, { title: string; pages: DocPage[] }>()
  for (const p of pages) {
    if (!map.has(p.section)) map.set(p.section, { title: p.sectionTitle, pages: [] })
    map.get(p.section)!.pages.push(p)
  }
  return [...map.values()]
}
