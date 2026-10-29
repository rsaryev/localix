import { memo } from 'react'
import { FolderGit2, RefreshCw, Settings2, Trash2, User } from 'lucide-react'
import type { Listing } from '@localixai/store'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { GetButton } from '@localixai/kit/get-button'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useStoreOpenAddress } from '@/shared/lib/storeInstallExtra'
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
  const opens = Boolean(useStoreOpenAddress(listing))
  if (listing.incompatible)
    return <span className="text-2xs text-text-faint">{listing.incompatible}</span>
  return (
    <GetButton
      name={listing.displayName}
      state={getStateOf(listing, opens)}
      size={size}
      onPress={() => store.get(listing)}
    />
  )
})

/**
 * The package page's action: the solid Get button, and beside it a quiet menu. Before it is got, a
 * chevron: where to get it (for you, or for the open project alone, where its kind
 * allows that) and the install extras, each said in its own words. Once installed, its options:
 * whether it updates on its own (from a signed catalog), get it in another scope, configure it,
 * add or remove an extra, remove it.
 */
export function PageGetAction({ listing, className }: { listing: Listing; className?: string }) {
  const store = useStoreScope()
  const state = getStateOf(listing, Boolean(useStoreOpenAddress(listing)))
  const project = store.project
  const scopes = KIND_SCOPES[listing.ref.kind].filter((scope) => scope === 'user' || project)
  const installedIn = new Set(listing.installs.map((install) => install.scope))
  const extras = store.extrasFor(listing)
  const where = (scope: 'user' | 'project') =>
    scope === 'user' ? 'For you, in every project' : `Only in ${project?.name ?? 'this project'}`
  const getting = state.kind === 'get' || state.kind === 'retry'
  const choose: MenuEntry[] = !getting
    ? []
    : [
        ...(scopes.length > 1
          ? scopes.map((scope) => ({
              id: `get:${scope}`,
              label: scope === 'user' ? 'Get for you' : `Get for ${project!.name}`,
              description: where(scope),
              icon: scope === 'user' ? User : FolderGit2,
              onSelect: () => store.get(listing, { scope }),
            }))
          : []),
        ...(scopes.length > 1 && extras.length ? [{ separator: true } as const] : []),
        ...(state.kind === 'get'
          ? extras.map((extra) => ({
              id: `with:${extra.id}`,
              label: extra.label,
              description: extra.hint,
              icon: extra.icon,
              onSelect: () => store.get(listing, { extra }),
            }))
          : []),
      ]
  const autoUpdate = listing.autoUpdate
  const manage: MenuEntry[] =
    listing.installs.length === 0
      ? []
      : [
          ...(autoUpdate === undefined
            ? []
            : [
                {
                  id: 'auto-update',
                  label: 'Update automatically',
                  description: 'Its catalog is signed: newer versions install on their own.',
                  icon: RefreshCw,
                  checked: autoUpdate,
                  onSelect: () => store.run(store.client.setAutoUpdate(listing.ref, !autoUpdate)),
                },
              ]),
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
  const label = choose.length
    ? `Where to get ${listing.displayName}`
    : `${listing.displayName} options`
  const menu = (entries: MenuEntry[]) =>
    entries.length ? { label, entries, choose: choose.length > 0 } : undefined
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {listing.incompatible ? (
        <>
          {manage.length > 0 && (
            <GetButton
              name={listing.displayName}
              state={{ kind: 'installed' }}
              size="md"
              menu={menu(manage)}
            />
          )}
          <span className="text-xs text-text-soft">{listing.incompatible}</span>
        </>
      ) : (
        <GetButton
          name={listing.displayName}
          state={state}
          size="md"
          emphasis="strong"
          onPress={() => store.get(listing)}
          menu={menu(choose.length ? choose : manage)}
        />
      )}
    </div>
  )
}
