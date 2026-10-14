import { CONTENT } from './content'
import { CONTROLS } from './controls'
import { FEEDBACK } from './feedback'
import { FOUNDATION } from './foundation'
import { LAYOUT } from './layout'
import { LISTS } from './lists'
import { OVERLAYS } from './overlays'
import type { KitCatalogEntry, KitCategory } from './types'

export type { KitCatalogEntry, KitCategory, KitProvider } from './types'

/** Every module a surface may take its parts from, grouped the way the docs present them. */
export const KIT_CATALOG: readonly KitCatalogEntry[] = [
  ...CONTROLS,
  ...OVERLAYS,
  ...LAYOUT,
  ...LISTS,
  ...FEEDBACK,
  ...CONTENT,
  ...FOUNDATION,
]

/** The order categories are presented in: from what a person touches to what it is built from. */
export const KIT_CATEGORY_ORDER: readonly KitCategory[] = [
  'controls',
  'overlays',
  'layout',
  'lists',
  'feedback',
  'content',
  'canvas',
  'keyboard',
  'recipes',
  'foundation',
]

const CATEGORY_TITLES: Record<KitCategory, string> = {
  controls: 'Controls',
  overlays: 'Overlays',
  layout: 'Layout',
  lists: 'Lists and rows',
  feedback: 'Feedback and status',
  content: 'Content',
  canvas: 'Board',
  keyboard: 'Keyboard',
  recipes: 'Class recipes',
  foundation: 'Foundation',
}

/**
 * The catalog as compact Markdown: one table per category, one row per module. It is what the
 * plugin kit stages as `KIT.md` and what the authoring instruction points the agent at, so the
 * agent picks by JOB instead of guessing from export names.
 */
export function renderKitCatalog(entries: readonly KitCatalogEntry[] = KIT_CATALOG): string {
  const lines: string[] = []
  for (const category of KIT_CATEGORY_ORDER) {
    const rows = entries.filter((entry) => entry.category === category)
    if (rows.length === 0) continue
    lines.push(
      `## ${CATEGORY_TITLES[category]}`,
      '',
      '| Module | Use it for | Not |',
      '| --- | --- | --- |',
    )
    for (const entry of rows) {
      const exports = entry.exports.map((name) => `\`${name}\``).join(', ')
      const cell = (text: string) => text.replaceAll('|', '\\|')
      lines.push(
        `| \`${entry.specifier}\` — ${exports} | ${cell(entry.summary)} ${cell(entry.use)} | ${cell(entry.not ?? '')} |`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}
