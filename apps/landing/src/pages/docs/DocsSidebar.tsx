import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, Search } from 'lucide-react'
import type { DocPage } from '@/generated/docs'
import { cn } from '@/lib/cn'
import { featureCategoryFor, groupByCategory, groupBySection } from '../docsNav'
import type { DocSearch } from './useDocSearch'

const branchDomId = (label: string) =>
  `docs-branch-${label.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-')}`

function PageList({ pages, activeSlug }: { pages: DocPage[]; activeSlug: string }) {
  return (
    <ul className="space-y-0.5">
      {pages.map((page) => (
        <li key={page.slug}>
          <Link
            to={`/docs/${page.slug}`}
            aria-current={page.slug === activeSlug ? 'page' : undefined}
            className={cn(
              'block rounded-md px-3 py-1.5 text-sm transition-colors',
              page.slug === activeSlug
                ? 'bg-surface-hover text-foreground'
                : 'text-text-soft hover:bg-surface-hover hover:text-foreground',
            )}
          >
            {page.title}
          </Link>
        </li>
      ))}
    </ul>
  )
}

/**
 * The desktop rail: one collapsible branch per docs section, built entirely
 * from the auto-collected tree. Open state is keyed by branch label; the active
 * page's branch (and its Features sub-category) auto-opens, and searching
 * expands everything so a match is never hidden behind a closed branch.
 */
export function DocsSidebar({ active, search }: { active: DocPage; search: DocSearch }) {
  const { query, setQuery, normalizedQuery, filtered, loadedContent, failed } = search
  const sections = groupBySection(filtered)
  const activeCategory = active.section === 'features' ? featureCategoryFor(active) : null

  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setOpenBranches((open) => ({
      ...open,
      [active.sectionTitle]: true,
      ...(activeCategory ? { [`${active.sectionTitle}::${activeCategory}`]: true } : {}),
    }))
  }, [active, activeCategory])

  const searching = query.trim().length > 0
  const isOpen = (key: string) => searching || (openBranches[key] ?? false)
  const toggle = (key: string) =>
    setOpenBranches((open) => ({ ...open, [key]: !(open[key] ?? false) }))

  return (
    <aside className="sticky top-8 hidden h-[calc(100vh-4rem)] w-60 shrink-0 overflow-y-auto md:block">
      <Link
        to="/"
        className="mb-5 flex items-center gap-2.5 font-heading text-base font-semibold tracking-tight text-foreground"
      >
        <img src="/logo.svg" alt="" className="size-6" />
        <span>Localix</span>
      </Link>
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
        <input
          type="search"
          aria-label="Search docs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search docs…"
          className="h-9 w-full rounded-lg border border-control-border bg-surface-raised pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-text-faint focus:border-control-border-focus focus-ring"
        />
      </div>
      {normalizedQuery && !loadedContent && !failed && (
        <p aria-live="polite" className="-mt-3 mb-3 px-3 text-xs text-text-faint">
          Searching full text…
        </p>
      )}
      <nav aria-label="Documentation" className="space-y-1.5">
        {sections.length === 0 && (
          <p role="status" className="px-3 text-sm text-text-faint">
            {loadedContent || failed ? `No pages match "${query}".` : 'Searching full text…'}
          </p>
        )}
        {failed && (
          <p className="px-3 pb-1 text-xs text-text-faint">
            Full-text search is unavailable; titles and summaries are still searchable.
          </p>
        )}
        {sections.map((section) => {
          const open = isOpen(section.title)
          const branchId = branchDomId(section.title)
          return (
            <div key={section.title}>
              <button
                type="button"
                onClick={() => toggle(section.title)}
                aria-expanded={open}
                aria-controls={branchId}
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium uppercase tracking-wide text-text-faint transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform', open && 'rotate-90')}
                />
                {section.title}
              </button>
              {open &&
                // Features get collapsible sub-categories; others are a flat branch.
                (section.pages[0]?.section === 'features' ? (
                  <div id={branchId} className="mt-1 space-y-2 pl-2">
                    {groupByCategory(section.pages).map((category) => {
                      const key = `${section.title}::${category.title}`
                      const categoryOpen = isOpen(key)
                      const categoryId = `${branchId}-${branchDomId(category.title)}`
                      return (
                        <div key={category.title}>
                          <button
                            type="button"
                            onClick={() => toggle(key)}
                            aria-expanded={categoryOpen}
                            aria-controls={categoryId}
                            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-text-soft transition-colors hover:text-foreground"
                          >
                            <ChevronRight
                              className={cn(
                                'size-3 transition-transform',
                                categoryOpen && 'rotate-90',
                              )}
                            />
                            {category.title}
                          </button>
                          {categoryOpen && (
                            <div
                              id={categoryId}
                              className="ml-2 border-l border-border-subtle pl-1"
                            >
                              <PageList pages={category.pages} activeSlug={active.slug} />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div id={branchId} className="mt-1">
                    <PageList pages={section.pages} activeSlug={active.slug} />
                  </div>
                ))}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
