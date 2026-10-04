import { memo, useEffect, useRef, type ReactNode } from 'react'
import type { SearchGroup, SearchHit } from '@localixai/api/client'
import { MatchedText } from '@localixai/kit/matched-text'
import { SectionLabel } from '@localixai/kit/section-label'
import { searchIconEl } from './searchIcons'

/**
 * The inner content of one search result — icon + fuzzy-highlighted title + one-line
 * subtitle — shared verbatim by the workspace tab's `ResultRow` (a `<button>`) and the
 * ⌘⇧F palette's cmdk `CommandItem`, so a hit looks identical in both surfaces. Memoized
 * on `{hit, query}`: during the scoped view's infinite scroll each `loadMore` appends a
 * page and re-renders the parent list, but a prior row's `hit`/`query` are unchanged, so
 * its `MatchedText` highlight spans aren't recomputed. Each surface keeps its own wrapper
 * (button vs CommandItem) and spacing; this owns only the shared inner markup.
 */
export const SearchHitContent = memo(function SearchHitContent({
  hit,
  query,
}: {
  hit: SearchHit
  query: string
}) {
  return (
    <>
      <span className="shrink-0 text-text-faint group-hover:text-text-soft">
        {searchIconEl(hit.icon, 'size-4')}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <MatchedText text={hit.title} query={query} />
        {hit.subtitle && <span className="truncate text-2xs text-text-faint">{hit.subtitle}</span>}
      </span>
    </>
  )
})

/** A single result — icon + fuzzy-highlighted title + one-line subtitle. Click activates. */
function ResultRow({
  hit,
  query,
  onActivate,
}: {
  hit: SearchHit
  query: string
  onActivate: (hit: SearchHit) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onActivate(hit)}
      className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
    >
      <SearchHitContent hit={hit} query={query} />
    </button>
  )
}

/** The heading row shared by both group views (icon + title + count). */
function GroupHeading({ group, action }: { group: SearchGroup; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <SectionLabel as="span" className="flex items-center gap-1.5">
        {searchIconEl(group.icon, 'size-3')}
        {group.title}
        <span className="text-text-faint/70">{group.total}</span>
      </SectionLabel>
      {action}
    </div>
  )
}

/** Aggregate view: a domain group with the top-N hits + a "Show all" affordance. */
export function GroupSection({
  group,
  query,
  onActivate,
  onShowAll,
}: {
  group: SearchGroup
  query: string
  onActivate: (hit: SearchHit) => void
  onShowAll: () => void
}) {
  const hidden = group.total - group.hits.length
  return (
    <section>
      <GroupHeading
        group={group}
        action={
          hidden > 0 ? (
            <button
              type="button"
              onClick={onShowAll}
              className="text-2xs text-text-soft transition-colors hover:text-foreground"
            >
              Show all →
            </button>
          ) : undefined
        }
      />
      <div className="flex flex-col">
        {group.hits.map((hit) => (
          <ResultRow key={hit.id} hit={hit} query={query} onActivate={onActivate} />
        ))}
      </div>
    </section>
  )
}

/** Scoped view: one domain's flat, paginated list with infinite scroll (a sentinel
 *  near the end fetches the next page). */
export function ScopedResults({
  group,
  query,
  onActivate,
  canLoadMore,
  onLoadMore,
}: {
  group: SearchGroup
  query: string
  onActivate: (hit: SearchHit) => void
  canLoadMore: boolean
  onLoadMore: () => void
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!canLoadMore) return
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore()
      },
      { rootMargin: '240px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [canLoadMore, onLoadMore])
  return (
    <section>
      <GroupHeading group={group} />
      <div className="flex flex-col">
        {group.hits.map((hit) => (
          <ResultRow key={hit.id} hit={hit} query={query} onActivate={onActivate} />
        ))}
      </div>
      {canLoadMore && <div ref={sentinel} className="h-8" />}
    </section>
  )
}
