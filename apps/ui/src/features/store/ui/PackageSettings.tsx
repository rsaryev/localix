import { useState } from 'react'
import type { Listing, Scope } from '@localixai/store'
import { Select } from '@localixai/kit/select'
import { Skeleton } from '@localixai/kit/skeleton'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { useStoreScope } from '../model/storeContext'
import { useListingConfig } from '../model/useStoreData'
import { ConfigForm } from './ConfigForm'

/**
 * A PACKAGE'S SETTINGS TAB: what its provider lets the person set, in the one configuration form.
 * A package installed for the person and for the open project has settings in each, with a switch
 * between them; the provider keeps where they are stored and checks what is saved.
 */
export function PackageSettings({ listing }: { listing: Listing }) {
  const store = useStoreScope()
  const [chosen, setChosen] = useState<Scope | null>(null)
  const known = listing.installs.map((install) => install.scope)
  // A project's settings need the open project: its install may be in another one.
  const offered = (['user', 'project'] as const).filter(
    (scope) => known.includes(scope) && (scope === 'user' || store.project),
  )
  const scope = chosen && offered.includes(chosen) ? chosen : (offered[0] ?? 'user')
  const projectId = scope === 'project' ? (store.project?.id ?? null) : null
  const { data, error, mutate } = useListingConfig(store.client, listing.ref, scope, projectId)

  return (
    <div className="flex max-w-3xl min-w-0 flex-col gap-4">
      {offered.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-text-soft">
          <span aria-hidden>Settings for</span>
          <Select
            size="md"
            aria-label="Settings for"
            value={scope}
            onValueChange={(next) => setChosen(next as Scope)}
            options={offered.map((value) => ({
              value,
              label: value === 'user' ? 'You' : (store.project?.name ?? 'This project'),
            }))}
          />
        </div>
      )}
      {data ? (
        <ConfigForm
          key={scope}
          config={data}
          onSave={async (values) => {
            await store.client.setConfig(listing.ref, scope, values, projectId ?? undefined)
            await mutate()
          }}
        />
      ) : error ? (
        <p role="alert" className="text-xs text-status-error">
          {errorMessage(error, 'Its settings could not be read')}
        </p>
      ) : (
        <div aria-busy className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
    </div>
  )
}
