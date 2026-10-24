import { Ellipsis, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import type { Listing, StoreInstall } from '@localixai/store'
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
import { keyOf } from '../model/filters'
import { KIND_LABELS } from '../model/presentation'
import { ListingTile } from './StoreMarks'

export interface LibraryActions {
  onOpen: (listing: Listing) => void
  onUpdate: (listing: Listing, install: StoreInstall) => void
  onRemove: (listing: Listing, install: StoreInstall) => void
  onEnable: (listing: Listing, install: StoreInstall, enabled: boolean) => void
  onConfigure: (uri: string) => void
}

const SCOPE_LABELS = { user: 'For you', project: 'In this project' } as const

function InstallRow({
  listing,
  install,
  ...actions
}: { listing: Listing; install: StoreInstall } & LibraryActions) {
  const name = listing.displayName
  const entries: MenuEntry[] = [
    ...(install.updateTo
      ? [
          {
            id: 'update',
            label: `Update to ${install.updateTo}`,
            icon: RefreshCw,
            onSelect: () => actions.onUpdate(listing, install),
          },
        ]
      : []),
    ...(listing.configure
      ? [
          {
            id: 'configure',
            label: 'Configure',
            icon: Settings2,
            onSelect: () => actions.onConfigure(listing.configure!),
          },
        ]
      : []),
    {
      id: 'remove',
      label: 'Remove',
      icon: Trash2,
      danger: true,
      onSelect: () => actions.onRemove(listing, install),
    },
  ]
  return (
    <li
      data-install={listing.ref.id}
      className="flex min-h-10 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-hover"
    >
      <ListingTile listing={listing} size={28} />
      <button
        type="button"
        className="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-foreground focus-ring"
        onClick={() => actions.onOpen(listing)}
      >
        {name}
      </button>
      <span className="w-20 shrink-0 truncate text-xs text-text-soft">
        {KIND_LABELS[listing.ref.kind].one}
      </span>
      <span className="w-24 shrink-0 truncate text-xs text-text-soft">
        {SCOPE_LABELS[install.scope]}
      </span>
      <span className="w-28 shrink-0 truncate text-2xs text-text-faint tabular-nums">
        {install.updateTo ? `${install.version ?? '?'} → ${install.updateTo}` : install.version}
      </span>
      <Switch
        size="sm"
        checked={install.enabled}
        aria-label={`${name} on`}
        onChange={(event) => actions.onEnable(listing, install, event.target.checked)}
      />
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
    </li>
  )
}

/**
 * The person's library: every install of any kind with its scope, version and switch (Installed),
 * or only those a newer version is offered for, with "Update all" (Updates). A row's menu
 * updates, configures (the provider's own settings) and removes it.
 */
export function StoreLibrary({
  listings,
  updates,
  onUpdateAll,
  ...actions
}: {
  listings: Listing[]
  updates?: boolean
  onUpdateAll: () => void
} & LibraryActions) {
  const rows = listings.flatMap((listing) =>
    listing.installs
      .filter((install) => !updates || install.updateTo)
      .map((install) => ({ listing, install })),
  )
  return (
    <section aria-label={updates ? 'Updates' : 'Installed'} className="flex flex-col gap-2">
      {updates && rows.length > 0 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-xs text-text-soft">
            {rows.length === 1 ? 'One update is ready.' : `${rows.length} updates are ready.`}
          </p>
          <Button size="sm" variant="field" onClick={onUpdateAll}>
            <RefreshCw data-icon="inline-start" aria-hidden />
            Update all
          </Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyHint>{updates ? 'Everything is up to date.' : 'Nothing is installed yet.'}</EmptyHint>
      ) : (
        <ul className="flex flex-col">
          {rows.map(({ listing, install }) => (
            <InstallRow
              key={`${keyOf(listing)}:${install.scope}`}
              listing={listing}
              install={install}
              {...actions}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
