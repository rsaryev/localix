import { useState } from 'react'
import type { Listing, PackageKind, Scope, StoreInstall } from '@localixai/store'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { ApiError } from '@/shared/api/internal'
import type { StoreClient } from '@/shared/api/store-client'
import { storeOpenAddress, type StoreInstallExtra } from '@/shared/lib/storeInstallExtra'
import { getStateOf } from './getState'
import { trustOf } from './presentation'
import type { StoreProject } from './storeContext'
import { useExtrasAfterInstall } from './useExtrasAfterInstall'

/** An install waiting on the person's yes, with what they chose. */
export interface ConsentRequest {
  listing: Listing
  scope: Scope
  extra?: StoreInstallExtra
}

/**
 * Where a kind can be installed. Every kind installs for the person; a plugin can also be
 * installed for the open project alone (Claude Code's `local` scope). One row per kind, as the
 * labels are; it names no provider.
 */
export const KIND_SCOPES: Record<PackageKind, readonly Scope[]> = {
  'mini-app': ['user'],
  plugin: ['user', 'project'],
  'mcp-server': ['user', 'project'],
  skill: ['user', 'project'],
  agent: ['user', 'project'],
}

/**
 * What the Store does to listings. Get installs at once from a verified source, and asks first —
 * the consent sheet with the plan — for a community one, or when the server says it needs a yes
 * (a 409: it runs code, its publisher is unverified). A project install names the open project.
 * A failure is said once, above the content; the `store` poke redraws everything else.
 */
export function useStoreActions(deps: {
  client: StoreClient
  project: StoreProject | null
  navigate: (uri: string) => void
}) {
  const { client, project } = deps
  const [problem, setProblem] = useState<string | null>(null)
  const [asking, setAsking] = useState<ConsentRequest | null>(null)
  const extras = useExtrasAfterInstall(client)
  const projectOf = (scope: Scope) => (scope === 'project' ? project?.id : undefined)
  const scopeOf = (listing: Listing, install?: StoreInstall): Scope =>
    install?.scope ?? listing.installs[0]?.scope ?? 'user'

  const run = (write: Promise<unknown>) =>
    void write
      .then(() => setProblem(null))
      .catch((error: unknown) => setProblem(errorMessage(error, 'The Store could not do that')))

  const install = async (request: ConsentRequest, consent: boolean) => {
    const { listing, scope, extra } = request
    await client.install(listing.ref, scope, { plan: consent }, projectOf(scope))
    if (extra) extras.afterInstall(extra, listing.ref)
  }

  const get = (listing: Listing, options: { scope?: Scope; extra?: StoreInstallExtra } = {}) => {
    const opens = storeOpenAddress(listing)
    const state = getStateOf(listing, Boolean(opens))
    if (state.kind === 'open' && opens) return deps.navigate(opens)
    if (state.kind === 'update') return update(listing)
    if (state.kind !== 'get' && state.kind !== 'retry') return
    const request = { listing, scope: options.scope ?? 'user', extra: options.extra }
    if (trustOf(listing) === 'community' || !listing.publisher.verified) return setAsking(request)
    void install(request, false)
      .then(() => setProblem(null))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 409) setAsking(request)
        else setProblem(errorMessage(error, 'It could not be installed'))
      })
  }

  const update = (listing: Listing, install?: StoreInstall) => {
    const scope = scopeOf(listing, install)
    run(client.update(listing.ref, scope, projectOf(scope)))
  }

  return {
    problem,
    dismissProblem: () => setProblem(null),
    asking,
    /** The consent sheet's answer: install with the person's yes, or nothing. */
    answer: (request: ConsentRequest | null) => {
      setAsking(null)
      if (request) run(install(request, true))
    },
    get,
    update,
    remove: (listing: Listing, install?: StoreInstall) => {
      const scope = scopeOf(listing, install)
      run(client.remove(listing.ref, scope, projectOf(scope)))
    },
    setEnabled: (listing: Listing, install: StoreInstall, enabled: boolean) =>
      run(client.setEnabled(listing.ref, install.scope, enabled, projectOf(install.scope))),
    updateAll: () => run(client.applyUpdates()),
    extras,
    run,
  }
}
