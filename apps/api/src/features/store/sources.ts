import {
  defaultSource,
  type PackageKind,
  type SourceView,
  type StoreProvider,
} from '@localixai/store'

import type { StoreIndexRepository } from './index-repository'

/**
 * THE SOURCES AS THE STORE SHOWS THEM (`docs/internals/store.md`, "Step 2c API as built"): what each
 * provider says of its sources, with when the Store last indexed each one and why it could not,
 * whether it is one a fresh profile starts with, and the kinds a source can be added for.
 */
export async function sourcesOf(
  providers: readonly StoreProvider[],
  index: Pick<StoreIndexRepository, 'sourceStates'>,
): Promise<{ sources: SourceView[]; addable: PackageKind[] }> {
  const [listed, states] = await Promise.all([
    Promise.all(providers.map((provider) => provider.sources())),
    index.sourceStates(),
  ])
  const sources = listed.flat().map((source): SourceView => {
    const state = states.get(`${source.kind}\u0000${source.id}`)
    const problem = source.problem ?? state?.error ?? undefined
    const syncedAt = source.syncedAt ?? state?.syncedAt
    const fromDefaults = source.defaultSource ?? defaultSource(source.id)?.kind === source.kind
    return {
      ...source,
      ...(syncedAt ? { syncedAt } : {}),
      ...(problem ? { problem } : {}),
      ...(fromDefaults ? { defaultSource: true } : {}),
    }
  })
  const addable = providers
    .filter((provider) => provider.previewSource && provider.addSource)
    .map((provider) => provider.kind)
  return { sources, addable }
}
