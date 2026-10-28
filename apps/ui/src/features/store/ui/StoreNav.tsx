import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { Chip } from '@localixai/kit/chip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { SectionHeading } from '@localixai/kit/section-heading'
import { TabBar } from '@localixai/kit/tabs'
import type { StoreLayout } from '../model/layout'
import type { StoreNavSections } from '../model/navigation'

/**
 * The Store's bar (`docs/internals/store.md`, "Screens"): the title, the search and the person's
 * library on one row, the catalog as tabs under it. The rarer kinds packages give wait under More,
 * which takes the name of the one chosen there. `active` is empty while a search is on screen.
 */
export function StoreNav({
  sections,
  active,
  onChange,
  search,
  layout,
}: {
  sections: StoreNavSections
  active: string
  onChange: (id: string) => void
  search: ReactNode
  layout: StoreLayout
}) {
  const narrow = layout === 'narrow'
  const inCatalog = sections.catalog.some((tab) => tab.id === active)
  return (
    <div data-store-nav className="flex flex-col">
      <header className="flex items-center gap-3 px-4 pt-3 pb-2">
        {!narrow && <SectionHeading as="h1" level="section" title="Store" className="shrink-0" />}
        <div className="max-w-xl min-w-0 flex-1">{search}</div>
        <nav aria-label="Your library" className="ml-auto flex shrink-0 items-center gap-0.5">
          {sections.library.map(({ id, label, icon: Icon, badge }) => {
            const current = id === active
            return (
              <Button
                key={id}
                size="sm"
                variant="ghost"
                aria-current={current ? 'page' : undefined}
                title={narrow ? label : undefined}
                className={cn(
                  'text-text-soft',
                  current && 'bg-surface-active text-foreground hover:bg-surface-active',
                )}
                onClick={() => onChange(id)}
              >
                {Icon && <Icon data-icon="inline-start" aria-hidden />}
                <span className={cn(narrow && 'sr-only')}>{label}</span>
                {badge !== undefined && (
                  <Chip size="dense" tone="accent" className="py-px">
                    {badge}
                  </Chip>
                )}
              </Button>
            )
          })}
        </nav>
      </header>
      <TabBar
        aria-label="Store sections"
        items={sections.catalog}
        active={inCatalog ? active : ''}
        onChange={onChange}
        className="px-2"
        trailing={
          sections.more.length > 0 && (
            <MoreSections sections={sections.more} active={active} onChange={onChange} />
          )
        }
      />
    </div>
  )
}

/** The kinds that are not tabs, as a tab-looking menu that is named for the one on screen. */
function MoreSections({
  sections,
  active,
  onChange,
}: {
  sections: StoreNavSections['more']
  active: string
  onChange: (id: string) => void
}) {
  const chosen = sections.find((tab) => tab.id === active)
  const Icon = chosen?.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={chosen ? `More sections: ${chosen.label}` : 'More sections'}
          aria-current={chosen ? 'page' : undefined}
          className={cn(
            'relative flex h-full items-center gap-1.5 px-3.5 text-sm font-medium transition-colors focus-ring',
            chosen ? 'text-foreground' : 'text-text-soft hover:text-foreground',
          )}
        >
          {Icon && <Icon className="size-3.5 opacity-70" aria-hidden />}
          <span>{chosen?.label ?? 'More'}</span>
          <ChevronDown className="size-3.5 opacity-70" aria-hidden />
          {chosen && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-foreground"
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <MenuEntries
          family="dropdown"
          entries={sections.map((tab) => ({
            id: tab.id,
            label: tab.label,
            selected: tab.id === active,
            onSelect: () => onChange(tab.id),
          }))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
