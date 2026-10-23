import { TextAction } from '@localixai/kit/text-action'
import { location } from '../shared/format'
import type { NodeSummaryView } from '../shared/view'
import { KIND_ICON, KIND_LABEL, KIND_TINT } from './kinds'

/**
 * Matches for the search box, over the map. Picking one moves the map to the level where the node
 * is a box and selects it; the ranking is the backend's (exact names first, then what more of the
 * project depends on), so the list is never re-sorted here.
 */
export function SearchResults({
  query,
  results,
  onPick,
}: {
  query: string
  results: readonly NodeSummaryView[] | undefined
  onPick: (node: NodeSummaryView) => void
}) {
  if (!query.trim()) return null
  return (
    <div className="absolute right-0 top-full z-(--z-popover) mt-1 w-80 overflow-hidden rounded-lg border border-border-soft bg-background shadow-(--shadow-popover)">
      {results === undefined ? (
        <p className="px-3 py-2 text-2xs text-text-faint">Searching…</p>
      ) : results.length === 0 ? (
        <p className="px-3 py-2 text-2xs text-text-faint">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.map((node) => {
            const Icon = KIND_ICON[node.kind]
            return (
              <li key={node.id}>
                <TextAction
                  className="flex w-full items-center gap-2 px-3 py-1 text-xs hover:bg-surface-hover"
                  onClick={() => onPick(node)}
                >
                  <Icon aria-hidden className={`size-3.5 shrink-0 ${KIND_TINT[node.kind]}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">{node.name}</span>
                    <span className="block truncate text-3xs text-text-faint">
                      {KIND_LABEL[node.kind]} · {location(node)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-3xs text-text-faint">
                    ← {node.dependents}
                  </span>
                </TextAction>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
