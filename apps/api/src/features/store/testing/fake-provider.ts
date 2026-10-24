import type { Editorial, Listing, PackageKind, SourceView, StoreProvider } from '@localixai/store'
import { makeListing, makeListingDetail } from '@localixai/store/testing'

/** A provider over a list in memory, recording every call it is asked to make. */
export function fakeProvider(
  kind: PackageKind,
  initial: Listing[],
  opts: {
    sources?: SourceView[]
    withoutOptional?: boolean
    fails?: string
    editorial?: Editorial[]
  } = {},
) {
  let listings = initial
  const calls: string[] = []
  const listeners = new Set<() => void>()
  const record = (call: string) => void calls.push(call)
  const provider: StoreProvider = {
    kind,
    async listings() {
      record('listings')
      if (opts.fails) throw new Error(opts.fails)
      return { listings, problems: [] }
    },
    async detail(id) {
      return makeListingDetail(listings.find((listing) => listing.ref.id === id)!)
    },
    async plan(id, scope) {
      return {
        scope,
        adds: [],
        runs: [],
        network: [],
        requires: [],
        warnings: [`plan for ${id}`],
        needsConsent: false,
      }
    },
    install: async (id, scope, consent) => record(`install ${id} ${scope} ${consent.plan}`),
    update: async (id, scope) => record(`update ${id} ${scope}`),
    remove: async (id, scope) => record(`remove ${id} ${scope}`),
    refresh: async () => record('refresh'),
    sources: async () => opts.sources ?? [],
    ...(opts.editorial ? { editorial: async () => opts.editorial! } : {}),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ...(opts.withoutOptional
      ? {}
      : {
          setEnabled: async (id, scope, enabled) => record(`enable ${id} ${scope} ${enabled}`),
          previewSource: async (input) => ({
            kind,
            id: input,
            label: input,
            publishers: ['Ada'],
            count: 2,
            icons: [],
            verified: false,
            added: false,
          }),
          addSource: async (input) => record(`add source ${input}`),
          removeSource: async (id) => record(`remove source ${id}`),
        }),
  }
  return {
    provider,
    calls,
    /** The provider's listings changed and it says so. */
    change(next: Listing[]) {
      listings = next
      for (const listener of listeners) listener()
    },
  }
}

export { makeListing }
