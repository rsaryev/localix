import { useState } from 'react'
import { BookMarked, CircleAlert, Ellipsis, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { SourceView } from '@localixai/store'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { ListSkeleton } from './PagedList'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { Switch } from '@localixai/kit/switch'
import { TRUST_LABELS, ago, plural, SOURCE_LABELS } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { useStoreSources } from '../model/useStoreData'

/** One source: who it is, how many packages, when it was read, its switch and its menu. */
function SourceRow({ source, onRemove }: { source: SourceView; onRemove: () => void }) {
  const store = useStoreScope()
  const entries: MenuEntry[] = [
    {
      id: 'update',
      label: 'Update now',
      icon: RefreshCw,
      onSelect: () => store.run(store.client.refreshSource(source.kind, source.id)),
    },
    ...(source.builtIn
      ? []
      : [
          { separator: true } as const,
          { id: 'remove', label: 'Remove…', icon: Trash2, danger: true, onSelect: onRemove },
        ]),
  ]
  const { trust } = source
  return (
    <li
      data-source={source.id}
      className="group/source relative grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-field-fill text-text-soft">
        <BookMarked className="size-4" aria-hidden />
      </span>
      <button
        type="button"
        className="flex min-w-0 flex-col rounded-sm text-left focus-ring"
        aria-label={`Show what ${source.label} offers`}
        onClick={() =>
          store.show({
            type: 'list',
            title: source.label,
            subtitle: source.url,
            query: { shelf: `package:${source.kind}`, source: source.id },
          })
        }
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
          <span className="truncate">{source.label}</span>
          {trust && (
            <span className="shrink-0 text-2xs font-normal text-text-faint">
              {TRUST_LABELS[trust]}
            </span>
          )}
        </span>
        <span className="truncate text-xs text-text-soft">
          {plural(source.count, 'package')}
          {source.syncedAt && ` · read ${ago(source.syncedAt)}`}
          {' · '}
          {source.url}
        </span>
        {source.problem && (
          <span className="flex min-w-0 items-center gap-1 text-xs text-text-soft">
            <CircleAlert className="size-3.5 shrink-0 text-status-warning" aria-hidden />
            <span className="truncate" title={source.problem}>
              {source.problem}
            </span>
          </span>
        )}
      </button>
      <div className="flex items-center gap-2">
        {source.autoUpdate !== undefined && (
          <Switch
            size="sm"
            checked={source.autoUpdate}
            aria-label={`Update ${source.label} on its own`}
            onChange={(event) =>
              store.run(
                store.client.setSourceAutoUpdate(source.kind, source.id, event.target.checked),
              )
            }
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" aria-label={`${source.label} actions`}>
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <MenuEntries entries={entries} family="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

/**
 * SOURCES (`docs/internals/store.md`, "Sources"): every place the Store reads packages from,
 * grouped by the kind they serve — each with who stands behind it, how many packages it offers,
 * when it was last read and why not when it could not be, its auto-update switch where it has
 * one, and Update and Remove. One "Add source…" takes any address. Pressing a source shows what
 * it offers.
 */
export function StoreSources({ onAdd }: { onAdd: () => void }) {
  const store = useStoreScope()
  const { data } = useStoreSources(store.client)
  const [removing, setRemoving] = useState<SourceView | null>(null)
  const sources = data?.sources ?? []
  const kinds = [...new Set(sources.map((source) => source.kind))]
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Sources</h2>
          <p className="text-sm text-text-soft">Where the Store finds what it offers.</p>
        </div>
        {(data?.addable.length ?? 0) > 0 && (
          <Button size="lg" variant="field" onClick={onAdd}>
            <Plus data-icon="inline-start" aria-hidden />
            Add source…
          </Button>
        )}
      </header>
      {!data ? (
        <ListSkeleton rows={4} />
      ) : kinds.length === 0 ? (
        <EmptyHint>No sources yet.</EmptyHint>
      ) : (
        kinds.map((kind) => (
          <section
            key={kind}
            aria-label={SOURCE_LABELS[kind].group}
            className="flex flex-col gap-1"
          >
            <h3 className="px-2 text-xs font-semibold text-text-soft">
              {SOURCE_LABELS[kind].group}
            </h3>
            <ul className="flex flex-col">
              {sources
                .filter((source) => source.kind === kind)
                .map((source) => (
                  <SourceRow key={source.id} source={source} onRemove={() => setRemoving(source)} />
                ))}
            </ul>
          </section>
        ))
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.label ?? 'this source'}?`}
        description={
          removing?.defaultSource
            ? 'It comes with Localix and will not come back on its own once removed. What you installed from it stays.'
            : 'What you installed from it stays; the Store stops offering the rest.'
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) store.run(store.client.removeSource(removing.kind, removing.id))
          setRemoving(null)
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  )
}
