import type {
  Editorial,
  Listing,
  PackageKind,
  SourceView,
  StoreInstall,
  StoreProvider,
} from '@localixai/store'
import { makeListing, makeListingDetail } from '@localixai/store/testing'

/** A provider over a list in memory, recording every call it is asked to make. */
export function fakeProvider(
  kind: PackageKind,
  initial: Listing[],
  opts: {
    sources?: SourceView[]
    withoutOptional?: boolean
    /** A kind the person makes here: no plan, install, update, sources or refresh. */
    madeHere?: boolean
    fails?: string
    /** Sources it could not read this time, while it still lists the rest. */
    problems?: string[]
    editorial?: Editorial[]
    /** The installs each project has, by project id and then listing id. */
    projectInstalls?: Record<string, Record<string, StoreInstall[]>>
    /** What each project keeps in its own folder, by project id. */
    projectListings?: Record<string, Listing[]>
  } = {},
) {
  let listings = initial
  let problems = opts.problems ?? []
  const calls: string[] = []
  const listeners = new Set<() => void>()
  const record = (call: string) => void calls.push(call)
  const provider: StoreProvider = {
    kind,
    async listings() {
      record('listings')
      if (opts.fails) throw new Error(opts.fails)
      return { listings, problems }
    },
    async detail(id) {
      return makeListingDetail(listings.find((listing) => listing.ref.id === id)!)
    },
    remove: async (id, scope) => record(`remove ${id} ${scope}`),
    ...(opts.madeHere
      ? {}
      : {
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
          refresh: async () => record('refresh'),
          sources: async () => opts.sources ?? [],
        }),
    ...(opts.editorial ? { editorial: async () => opts.editorial! } : {}),
    ...(opts.projectInstalls
      ? {
          projectInstalls: async (actor) => {
            record(`project installs ${actor.projectId}`)
            return Object.entries(opts.projectInstalls![actor.projectId] ?? {}).map(
              ([id, installs]) => ({ id, installs }),
            )
          },
        }
      : {}),
    ...(opts.projectListings
      ? { projectListings: async (actor) => opts.projectListings![actor.projectId] ?? [] }
      : {}),
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
          refreshSource: async (id) => record(`refresh source ${id}`),
          setSourceAutoUpdate: async (id, on) => record(`auto-update ${id} ${on}`),
        }),
  }
  return {
    provider,
    calls,
    /** The provider's listings changed and it says so. */
    change(next: Listing[], nextProblems = problems) {
      listings = next
      problems = nextProblems
      for (const listener of listeners) listener()
    },
  }
}

export { makeListing }
