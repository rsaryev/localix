/** Searchable engine catalogue generated entirely from the canonical driver manifest. */
import { useMemo, useState } from 'react'
import { ArrowRight, File, Search, Server } from 'lucide-react'
import { SearchInput } from '@localixai/kit/search-input'
import { cn, FIELD_SURFACE } from '@localixai/plugin-sdk/ui/classes'
import { Select } from '@localixai/kit/select'
import { DATABASE_DRIVERS, type DatabaseCategory } from '../../../shared/driver-catalog'
import { DIALECTS, DIALECT_LABEL, DIALECT_META } from '../../model/dialects'
import type { ConnectFormState } from './useConnectForm'

const CATEGORY_ORDER: DatabaseCategory[] = ['local', 'relational', 'analytics', 'nosql', 'search']

const CATEGORY_LABEL: Record<DatabaseCategory, string> = {
  local: 'Local',
  relational: 'Relational SQL',
  analytics: 'Analytics',
  nosql: 'NoSQL',
  search: 'Search',
}

export function EnginePicker({
  f,
  isEdit,
  variant = 'compact',
  onSelected,
}: {
  f: ConnectFormState
  isEdit: boolean
  variant?: 'compact' | 'workspace'
  onSelected?: () => void
}) {
  const [search, setSearch] = useState('')
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return DATABASE_DRIVERS
    return DATABASE_DRIVERS.filter((driver) =>
      [driver.label, driver.description, driver.queryLanguage, driver.kind, driver.transport]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [search])

  if (!isEdit && variant === 'workspace') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border-soft px-4 py-3 @2xl:px-6">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search databases…"
            autoFocus
            className="w-full"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="flex w-full flex-col gap-5 px-4 py-4 @2xl:px-6">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center py-14 text-center">
                <Search className="size-7 text-text-faint/50" />
                <p className="mt-2 text-xs text-text-soft">No databases match “{search}”.</p>
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="mt-1 rounded-sm text-2xs font-medium text-foreground outline-none hover:underline focus-ring"
                >
                  Clear search
                </button>
              </div>
            ) : (
              CATEGORY_ORDER.map((category) => {
                const drivers = visible.filter((driver) => driver.category === category)
                if (drivers.length === 0) return null
                return (
                  <section key={category}>
                    <h2 className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-text-faint">
                      {CATEGORY_LABEL[category]}
                      <span className="font-normal tabular-nums">{drivers.length}</span>
                    </h2>
                    <div className="divide-y divide-border-faint border-y border-border-faint">
                      {drivers.map((driver) => {
                        const meta = DIALECT_META[driver.id]
                        return (
                          <button
                            key={driver.id}
                            type="button"
                            onClick={() => {
                              f.selectDialect(driver.id)
                              onSelected?.()
                            }}
                            className="group flex min-h-14 w-full items-center gap-3 px-2 py-2 text-left outline-none transition-colors hover:bg-surface-hover/60 focus-ring"
                          >
                            <span
                              className={cn(
                                'flex size-7 shrink-0 items-center justify-center text-2xs font-semibold',
                                meta.tintText,
                              )}
                            >
                              {meta.badge}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-semibold text-foreground">
                                  {driver.label}
                                </span>
                                <span className="flex items-center gap-1 text-2xs text-text-faint">
                                  {driver.transport === 'file' ? (
                                    <File className="size-2.5" />
                                  ) : (
                                    <Server className="size-2.5" />
                                  )}
                                  {driver.kind === 'sql' ? 'SQL' : driver.kind}
                                </span>
                              </span>
                              <span className="mt-0.5 line-clamp-2 text-2xs leading-snug text-text-faint">
                                {driver.description}
                              </span>
                            </span>
                            <ArrowRight className="size-3.5 shrink-0 text-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        )
                      })}
                    </div>
                  </section>
                )
              })
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-2.5">
      <label id="database-engine-label" className="mb-1 block text-2xs text-text-soft">
        Database
      </label>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-2xs font-semibold',
            DIALECT_META[f.dialect].tintText,
          )}
        >
          {DIALECT_META[f.dialect].badge}
        </span>
        {isEdit ? (
          // The locked dialect stands in for the Select, so it wears the SAME field recipe. A
          // hand-transcribed copy of that recipe (`bg-foreground/[0.04]`) drifted from the kit's
          // `bg-field-fill` token, and the locked field read as a different control beside its
          // editable siblings; FIELD_SURFACE is the one owner of border, radius and fill.
          <div
            className={cn(
              FIELD_SURFACE,
              'flex h-[var(--chrome-control-md)] min-w-0 flex-1 items-center px-2 text-xs font-medium text-foreground',
            )}
          >
            {DIALECT_LABEL[f.dialect]}
          </div>
        ) : (
          <Select
            value={f.dialect}
            onValueChange={(value) => {
              const dialect = DIALECTS.find((item) => item.id === value)
              if (dialect) f.selectDialect(dialect.id)
            }}
            options={DIALECTS.map((dialect) => ({ value: dialect.id, label: dialect.label }))}
            size="md"
            aria-labelledby="database-engine-label"
            className="min-w-0 flex-1"
          />
        )}
      </div>
    </div>
  )
}
