import { Link, useNavigate } from 'react-router'
import { Search } from 'lucide-react'
import { docPages, type DocPage } from '@/generated/docs'
import { groupBySection } from '../docsNav'
import type { DocSearch } from './useDocSearch'

/**
 * Below `md` the rail is hidden, so the article carries its own way to move
 * between pages: the same search, a grouped `<select>` over every page, and the
 * top matches once a query narrows the list.
 */
export function DocsMobilePicker({ active, search }: { active: DocPage; search: DocSearch }) {
  const navigate = useNavigate()
  const { query, setQuery, normalizedQuery, filtered, loadedContent, failed } = search
  const settled = loadedContent !== null || failed

  return (
    <div className="mb-6 md:hidden">
      <label
        htmlFor="documentation-search"
        className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-faint"
      >
        Search documentation
      </label>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" />
        <input
          id="documentation-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search docs…"
          className="h-10 w-full rounded-lg border border-control-border bg-surface-raised pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-text-faint focus:border-control-border-focus focus-ring"
        />
      </div>
      <label
        htmlFor="documentation-page"
        className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-faint"
      >
        Documentation
      </label>
      <select
        id="documentation-page"
        value={active.slug}
        onChange={(event) => void navigate(`/docs/${event.target.value}`)}
        className="h-10 w-full rounded-lg border border-control-border bg-surface-raised px-3 text-sm text-foreground outline-none focus:border-control-border-focus focus-ring"
      >
        {groupBySection(docPages).map((section) => (
          <optgroup key={section.title} label={section.title}>
            {section.pages.map((page) => (
              <option key={page.slug} value={page.slug}>
                {page.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {normalizedQuery && filtered.length > 0 && (
        <ul className="mt-3 space-y-1">
          {filtered.slice(0, 8).map((page) => (
            <li key={page.slug}>
              <Link
                to={`/docs/${page.slug}`}
                className="block rounded-md px-2 py-1.5 text-sm text-text-soft hover:bg-surface-hover hover:text-foreground"
              >
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {normalizedQuery && filtered.length === 0 && settled && (
        <p role="status" className="mt-2 text-sm text-text-faint">
          No pages match “{query}”.
        </p>
      )}
      {normalizedQuery && filtered.length === 0 && !settled && (
        <p aria-live="polite" className="mt-2 text-sm text-text-faint">
          Searching full text…
        </p>
      )}
    </div>
  )
}
