import type { DiscoverResponse, StoreCategory } from '@localixai/store'
import { CATEGORY_ICONS } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'

/**
 * The Store's categories with how many each holds; one opens its list. Each is as wide as its
 * name and count need and the row wraps, so a name that fits is never cut and no cell is left
 * empty at the end.
 */
export function Categories({ categories }: { categories: DiscoverResponse['categories'] }) {
  const store = useStoreScope()
  return (
    <section aria-label="Categories" className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">Categories</h2>
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.id as StoreCategory] ?? CATEGORY_ICONS.Other
          return (
            <button
              key={category.id}
              type="button"
              onClick={() =>
                store.show({
                  type: 'list',
                  title: category.label,
                  query: { category: category.id as StoreCategory },
                })
              }
              className="flex h-10 max-w-full min-w-0 items-center gap-2.5 rounded-lg bg-field-fill px-3 text-left text-sm text-foreground transition-colors duration-(--dur-fast) hover:bg-surface-hover focus-ring"
            >
              <Icon className="size-4 shrink-0 text-text-soft" aria-hidden />
              <span className="min-w-0 truncate">{category.label}</span>
              <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                {category.count.toLocaleString('en-US')}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
