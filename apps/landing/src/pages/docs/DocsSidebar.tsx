import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { SearchInput } from '@localixai/kit/search-input'
import type { DocPage } from '../../generated/docs'
import { cn } from '../../lib/cn'
import { featureCategoryFor, groupByCategory, groupBySection } from './docGroups'
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

  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>(() => ({
    [active.sectionTitle]: true,
    ...(activeCategory ? { [`${active.sectionTitle}::${activeCategory}`]: true } : {}),
  }))
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
    <aside className="docs-sidebar sticky top-8 hidden h-[calc(100vh-4rem)] overflow-y-auto md:block">
      <SearchInput
        aria-label="Search docs"
        value={query}
        onValueChange={setQuery}
        placeholder="Search docs…"
        className="mb-6"
      />
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggle(section.title)}
                aria-expanded={open}
                aria-controls={branchId}
                className="w-full justify-start px-1 text-xs font-medium text-text-faint hover:text-foreground"
              >
                <ChevronRight
                  className={cn('size-3.5 transition-transform', open && 'rotate-90')}
                />
                {section.title}
              </Button>
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
                          <Button
                            variant="ghost"
                            size="default"
                            onClick={() => toggle(key)}
                            aria-expanded={categoryOpen}
                            aria-controls={categoryId}
                            className="w-full justify-start px-2 text-sm font-medium text-text-soft hover:text-foreground"
                          >
                            <ChevronRight
                              className={cn(
                                'size-3 transition-transform',
                                categoryOpen && 'rotate-90',
                              )}
                            />
                            {category.title}
                          </Button>
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
