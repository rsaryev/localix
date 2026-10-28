import { ProgressBar } from '@localixai/kit/progress-bar'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SemanticStatus } from '@/shared/api/semanticApi'

type Collection = SemanticStatus['index']['collections'][number]

const count = new Intl.NumberFormat()

/** How far a collection's build has come, or null when it is not building (or cannot say). */
function buildPercent(collection: Collection): number | null {
  if (!collection.reconciling || !collection.total) return null
  return Math.min(100, Math.round(((collection.scanned ?? 0) / collection.total) * 100))
}

/**
 * The index by category, as a table: one row
 * per collection — what its source calls it, how many items it holds — and a bar. At rest the bar
 * is the category's share of the index; while it builds, how far the build has come. The list is
 * the status's own, so a plugin's collection appears with it, named by its source.
 */
export function SemanticIndexBreakdown({ collections }: { collections: readonly Collection[] }) {
  if (collections.length === 0) return null
  const total = collections.reduce((sum, c) => sum + c.items, 0)
  const rows = [...collections].sort((a, b) => b.items - a.items || a.label.localeCompare(b.label))
  return (
    <section aria-label="Index by category" className="space-y-2 px-2 pt-1 pb-2">
      <p className="text-2xs font-medium text-text-strong">By category</p>
      <ul className="space-y-2.5">
        {rows.map((collection) => {
          const building = buildPercent(collection)
          const value = building ?? (total > 0 ? (collection.items / total) * 100 : 0)
          return (
            <li key={collection.name} className="space-y-1">
              <div className="flex items-center gap-2 text-2xs">
                <span className="min-w-0 flex-1 truncate text-text-strong">{collection.label}</span>
                {building !== null && (
                  <span className="font-mono tabular-nums text-text-faint">{building}%</span>
                )}
                <span className="w-14 text-right font-mono tabular-nums text-text-soft">
                  {count.format(collection.items)}
                </span>
              </div>
              <ProgressBar
                value={value}
                aria-label={
                  building !== null
                    ? `${collection.label} indexing progress`
                    : `${collection.label} share of the index`
                }
                className="h-1 bg-surface-active"
                fillClassName={cn(building !== null ? 'bg-status-info/70' : 'bg-foreground/60')}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
