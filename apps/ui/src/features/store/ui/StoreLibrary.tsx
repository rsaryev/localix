import { memo, useState } from 'react'
import { Ellipsis, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { PACKAGE_KINDS, type Listing, type StoreInstall } from '@localixai/store'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { Switch } from '@localixai/kit/switch'
import { TogglePill } from '@localixai/kit/toggle-pill'
import { KIND_LABELS, plural } from '../model/presentation'
import { useStoreScope } from '../model/storeContext'
import { keyOf } from '../model/useExtrasAfterInstall'
import { usePagedListings } from '../model/useStoreData'
import { ListSkeleton, PagedList } from './PagedList'
import { ListingIcon } from './StoreMarks'

interface Row {
  listing: Listing
  install: StoreInstall
}

/** One install, densely: icon, name, kind, where, version, its switch and its menu. */
const InstallRow = memo(function InstallRow({
  listing,
  install,
  updates,
}: Row & { updates: boolean }) {
  const store = useStoreScope()
  const name = listing.displayName
  const where = install.scope === 'user' ? 'For you' : `In ${store.project?.name ?? 'this project'}`
  const entries: MenuEntry[] = [
    ...(install.updateTo
      ? [
          {
            id: 'update',
            label: `Update to ${install.updateTo}`,
            icon: RefreshCw,
            onSelect: () => store.update(listing, install),
          },
        ]
      : []),
    ...(listing.configurable
      ? [
          {
            id: 'configure',
            label: 'Configure',
            icon: Settings2,
            onSelect: () => store.configure(listing),
          },
        ]
      : []),
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => store.remove(listing, install),
    },
  ]
  return (
    <li
      data-install={listing.ref.id}
      className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-hover @2xl:grid-cols-[auto_minmax(0,1fr)_6rem_8rem_8rem_auto]"
    >
      <ListingIcon listing={listing} size={32} />
      <button
        type="button"
        className="min-w-0 truncate rounded-sm text-left text-sm text-foreground focus-ring"
        onClick={() => store.open(listing)}
      >
        {name}
      </button>
      <span className="hidden truncate text-xs text-text-soft @2xl:block">
        {KIND_LABELS[listing.ref.kind].one}
      </span>
      <span className="hidden truncate text-xs text-text-soft @2xl:block">{where}</span>
      <span className="hidden truncate text-2xs text-text-faint tabular-nums @2xl:block">
        {install.updateTo ? `${install.version ?? '?'} → ${install.updateTo}` : install.version}
      </span>
      <div className="flex items-center gap-1.5">
        {updates ? (
          <Button size="sm" variant="field" onClick={() => store.update(listing, install)}>
            Update
          </Button>
        ) : (
          <Switch
            size="sm"
            checked={install.enabled}
            aria-label={`${name} on`}
            onChange={(event) => store.setEnabled(listing, install, event.target.checked)}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton size="sm" aria-label={`${name} actions`}>
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <MenuEntries entries={entries} family="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
})

/**
 * The person's library: every install of any kind, densely, with its kind, where it is installed,
 * its version, its switch and a menu to update, configure or remove it, filtered by kind
 * (Installed); or what a newer version is offered for, each with Update and all with Update all
 * (Updates).
 */
export function StoreLibrary({ updates = false }: { updates?: boolean }) {
  const store = useStoreScope()
  const [kind, setKind] = useState<string | null>(null)
  const page = usePagedListings(store.client, {
    shelf: updates ? 'updates' : kind ? `package:${kind}` : 'installed',
    ...(kind && !updates ? { installed: true } : {}),
    ...(store.project ? { projectId: store.project.id } : {}),
  })
  const rows: Row[] = page.listings.flatMap((listing) =>
    listing.installs
      .filter((install) => !updates || install.updateTo)
      .map((install) => ({ listing, install })),
  )
  // The chips keep the kinds of everything installed, so choosing one does not hide the others.
  const [kinds, setKinds] = useState<string[]>([])
  const seen = PACKAGE_KINDS.filter((k) => (page.first?.facets.kind[k] ?? 0) > 0)
  if (!kind && page.first && seen.join() !== kinds.join()) setKinds(seen)
  return (
    <section
      aria-label={updates ? 'Updates' : 'Installed'}
      className="@container flex flex-col gap-3"
    >
      {updates
        ? rows.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-soft">{plural(rows.length, 'update')} ready</p>
              <Button size="sm" variant="field" onClick={store.updateAll}>
                <RefreshCw data-icon="inline-start" aria-hidden />
                Update all
              </Button>
            </div>
          )
        : (kinds.length > 1 || kind) && (
            <div role="group" aria-label="Kinds" className="flex flex-wrap gap-1.5">
              <TogglePill active={kind === null} onClick={() => setKind(null)}>
                Everything
              </TogglePill>
              {PACKAGE_KINDS.filter((k) => kinds.includes(k)).map((k) => (
                <TogglePill key={k} active={kind === k} onClick={() => setKind(k)}>
                  {KIND_LABELS[k].many}
                </TogglePill>
              ))}
            </div>
          )}
      {page.loading ? (
        <ListSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <EmptyHint>{updates ? 'Everything is up to date.' : 'Nothing is installed yet.'}</EmptyHint>
      ) : (
        <PagedList
          label={updates ? 'Updates' : 'Installs'}
          items={rows}
          columns={1}
          keyOf={({ listing, install }) => `${keyOf(listing.ref)}:${install.scope}`}
          render={(row) => <InstallRow {...row} updates={updates} />}
          hasMore={page.hasMore}
          loadMore={page.loadMore}
          loadingMore={page.loadingMore}
        />
      )}
    </section>
  )
}
