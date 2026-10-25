import { memo } from 'react'
import { ChevronDown, Ellipsis, FolderGit2, Settings2, Trash2, User } from 'lucide-react'
import type { Listing } from '@localixai/store'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { GetButton } from '@localixai/kit/get-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { storeOpenAddress } from '@/shared/lib/storeInstallExtra'
import { getStateOf } from '../model/getState'
import { useStoreScope } from '../model/storeContext'
import { KIND_SCOPES } from '../model/useStoreActions'

/**
 * A listing's one control on a tile or a row: the Get button through its whole life. Pressing it
 * gets, updates, retries or opens; what cannot be installed here says why instead.
 */
export const GetAction = memo(function GetAction({
  listing,
  size = 'sm',
}: {
  listing: Listing
  size?: 'sm' | 'md'
}) {
  const store = useStoreScope()
  if (listing.incompatible)
    return <span className="text-2xs text-text-faint">{listing.incompatible}</span>
  return (
    <GetButton
      name={listing.displayName}
      state={getStateOf(listing, Boolean(storeOpenAddress(listing)))}
      size={size}
      onPress={() => store.get(listing)}
    />
  )
})

/**
 * The package page's action: the solid Get button, beside it a chevron choosing where to get it
 * (for you, or for the open project alone, where its kind allows that), the install extras
 * labelled, and once installed a menu to remove it from a scope, configure it, or add or remove
 * an extra.
 */
export function PageGetAction({ listing, className }: { listing: Listing; className?: string }) {
  const store = useStoreScope()
  const state = getStateOf(listing, Boolean(storeOpenAddress(listing)))
  const project = store.project
  const scopes = KIND_SCOPES[listing.ref.kind].filter((scope) => scope === 'user' || project)
  const installedIn = new Set(listing.installs.map((install) => install.scope))
  const extras = store.extrasFor(listing)
  const where = (scope: 'user' | 'project') =>
    scope === 'user' ? 'For you, in every project' : `Only in ${project?.name ?? 'this project'}`
  const choose: MenuEntry[] =
    scopes.length > 1 && (state.kind === 'get' || state.kind === 'retry')
      ? scopes.map((scope) => ({
          id: `get:${scope}`,
          label: scope === 'user' ? 'Get for you' : `Get for ${project!.name}`,
          description: where(scope),
          icon: scope === 'user' ? User : FolderGit2,
          onSelect: () => store.get(listing, { scope }),
        }))
      : []
  const manage: MenuEntry[] =
    listing.installs.length === 0
      ? []
      : [
          ...scopes
            .filter((scope) => !installedIn.has(scope))
            .map((scope) => ({
              id: `also:${scope}`,
              label: scope === 'user' ? 'Also get for you' : `Also get for ${project!.name}`,
              description: where(scope),
              icon: scope === 'user' ? User : FolderGit2,
              onSelect: () => store.get({ ...listing, installs: [] }, { scope }),
            })),
          ...extras.map((extra) => {
            const has = extra.has(listing)
            return {
              id: `extra:${extra.id}`,
              label: has ? `Remove ${extra.makes}` : `Add ${extra.makes}`,
              icon: has ? Trash2 : extra.icon,
              onSelect: () =>
                has ? store.removeExtra(extra, listing) : store.makeExtra(extra, listing),
            }
          }),
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
          { separator: true } as const,
          ...listing.installs.map((install) => ({
            id: `remove:${install.scope}`,
            label:
              listing.installs.length > 1
                ? install.scope === 'user'
                  ? 'Remove for you'
                  : `Remove from ${project?.name ?? 'this project'}`
                : 'Remove',
            icon: Trash2,
            danger: true,
            onSelect: () => store.remove(listing, install),
          })),
        ]
  const menu = choose.length ? choose : manage
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {listing.incompatible ? (
        <span className="text-xs text-text-soft">{listing.incompatible}</span>
      ) : (
        <GetButton
          name={listing.displayName}
          state={state}
          size="lg"
          emphasis="strong"
          onPress={() => store.get(listing)}
        />
      )}
      {menu.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              size="lg"
              className="rounded-full"
              aria-label={
                choose.length
                  ? `Where to get ${listing.displayName}`
                  : `${listing.displayName} options`
              }
            >
              {choose.length ? <ChevronDown /> : <Ellipsis />}
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <MenuEntries entries={menu} family="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {state.kind === 'get' &&
        extras.map((extra) => (
          <IconButton
            key={extra.id}
            size="lg"
            className="rounded-full"
            aria-label={`${extra.label}: ${listing.displayName}`}
            tooltip={`${extra.label} — ${extra.hint.toLowerCase()}`}
            onClick={() => store.get(listing, { extra })}
          >
            <extra.icon />
          </IconButton>
        ))}
    </div>
  )
}
