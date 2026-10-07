import { Link, useNavigate } from 'react-router'
import { ChevronDown } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { SearchInput } from '@localixai/kit/search-input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { docPages, type DocPage } from '../../generated/docs'
import { groupBySection } from './docGroups'
import type { DocSearch } from './useDocSearch'

/**
 * Below `md` the rail is hidden, so the article carries its own way to move
 * between pages: the same search, a grouped menu over every page, and the
 * top matches once a query narrows the list.
 */
export function DocsMobilePicker({ active, search }: { active: DocPage; search: DocSearch }) {
  const navigate = useNavigate()
  const { query, setQuery, normalizedQuery, filtered, loadedContent, failed } = search
  const settled = loadedContent !== null || failed

  return (
    <div className="mb-6 md:hidden">
      <SearchInput
        aria-label="Search docs"
        value={query}
        onValueChange={setQuery}
        placeholder="Search docs…"
        size="xl"
        className="mb-2"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xl"
            aria-label="Browse documentation"
            className="w-full justify-between px-0"
          >
            <span className="truncate">{active.title}</span>
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <MenuEntries
            family="dropdown"
            entries={groupBySection(docPages).map((section) => ({
              id: section.title,
              label: section.title,
              items: section.pages.map((page) => ({
                id: page.slug,
                label: page.title,
                selected: page.slug === active.slug,
                onSelect: () => void navigate(`/docs/${page.slug}`),
              })),
            }))}
          />
        </DropdownMenuContent>
      </DropdownMenu>
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
