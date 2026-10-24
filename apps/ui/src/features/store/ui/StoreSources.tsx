import { BookMarked, Plus, Trash2 } from 'lucide-react'
import type { PackageKind, SourceView } from '@localixai/store'
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { plural, SOURCE_LABELS } from '../model/presentation'

/**
 * Sources, grouped by the kind they serve: Localix's own first, which always stays, then the ones
 * the person added, each with how many packages it offers and removable, and "Add …" — the same
 * dialog the shelves' source menu opens.
 */
export function StoreSources({
  sources,
  onRemove,
  onAdd,
}: {
  sources: readonly SourceView[]
  onRemove: (source: SourceView) => void
  onAdd: (kind: PackageKind) => void
}) {
  const kinds = [...new Set(sources.map((source) => source.kind))]
  if (kinds.length === 0) return <EmptyHint>No sources yet.</EmptyHint>
  return (
    <div className="flex flex-col gap-6">
      {kinds.map((kind) => {
        const { group, one } = SOURCE_LABELS[kind]
        return (
          <section key={kind} aria-label={group} className="flex flex-col gap-1">
            <h2 className="px-2 text-xs font-medium text-text-soft">{group}</h2>
            <ul className="flex flex-col">
              {sources
                .filter((source) => source.kind === kind)
                .map((source) => (
                  <li
                    key={source.id}
                    className="group/source flex min-h-10 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover"
                  >
                    <BookMarked className="size-4 shrink-0 text-text-faint" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{source.label}</p>
                      <p className="truncate text-xs text-text-soft" title={source.url}>
                        {source.builtIn ? 'Comes with Localix' : source.url}
                      </p>
                    </div>
                    <span className="shrink-0 text-2xs text-text-faint tabular-nums">
                      {plural(source.count, 'package')}
                    </span>
                    {source.builtIn ? (
                      <span className="w-6 shrink-0" />
                    ) : (
                      <IconButton
                        size="sm"
                        aria-label={`Remove ${source.label}`}
                        className="opacity-0 group-hover/source:opacity-100 focus-visible:opacity-100"
                        onClick={() => onRemove(source)}
                      >
                        <Trash2 />
                      </IconButton>
                    )}
                  </li>
                ))}
            </ul>
            <div className="px-2">
              <Button size="sm" variant="field" onClick={() => onAdd(kind)}>
                <Plus data-icon="inline-start" aria-hidden />
                Add a {one}…
              </Button>
            </div>
          </section>
        )
      })}
    </div>
  )
}
