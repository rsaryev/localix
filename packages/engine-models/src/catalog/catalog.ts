/**
 * THE MODEL CATALOG: what this engine can serve, from models.dev, kept current at little cost.
 *
 * The first read takes the copy the host's store kept; with none, the snapshot shipped in the SDK
 * (stored at once, so it is imported once). A refresh asks models.dev conditionally: an unchanged
 * catalog costs a 304, and a fetched one that normalizes to the same document changes nothing, so
 * the host hears `changed` only when the list really did. Beside models.dev it lists the host's
 * own `local` provider, read on every projection.
 */
import { createHash } from 'node:crypto'

import type {
  EngineCatalog,
  EngineCatalogRefreshOptions,
  EngineCatalogRefreshResult,
  EngineCatalogStore,
  LocalProviderHost,
  RuntimeModelRef,
} from '@localixai/agent/runtime'
import { LOCAL_PROVIDER_ID } from '@localixai/agent/runtime'

import { OAUTH_LOGINS, wireOf, type OAuthLogin, type Route } from './families'
import { listedProvider, localProvider } from './listing'
import {
  DOCUMENT_SCHEMA,
  listedModel,
  normalize,
  readDocument,
  type CatalogDocument,
  type ServedModel,
  type ServedProvider,
} from './normalize'
import { fetchModelsDev, loadSnapshot } from './source'

const STORE_KEY = 'models.dev'
/** The host checks hourly; a copy younger than this is not asked about again. */
const FRESH_MS = 50 * 60 * 1000

/** One model as the runtime needs it: how to reach it and what it is. */
export interface CatalogEntry {
  provider: {
    id: string
    name: string
    /** The provider's own address, which a model's own address may extend (`…/v1`). */
    baseURL?: string
    oauth?: OAuthLogin
    /** Served from the host's own server (`local`): address and readiness come from the host. */
    local: boolean
  }
  route: Route
  model: ServedModel & { kind: 'chat' | 'decision'; api: string }
}

interface StoredEntry {
  schema: number
  fetchedAt: number
  etag?: string
  digest: string
  document: CatalogDocument
}

export interface ModelCatalogOptions {
  store?: EngineCatalogStore
  local?: LocalProviderHost
  /** A stored copy was dropped instead of restored (unreadable or another format). */
  onDropped?: (key: string, reason: string) => void
  fetch?: typeof globalThis.fetch
}

const digestOf = (document: CatalogDocument) =>
  createHash('sha256').update(JSON.stringify(document)).digest('hex')

export function createModelCatalog(options: ModelCatalogOptions = {}) {
  let state: Omit<StoredEntry, 'schema'> | undefined
  let loading: Promise<void> | undefined
  let projection: EngineCatalog | undefined
  /** Bumped by every change a projection in flight must not outlive. */
  let generation = 0
  /** The one network check in flight, shared by every caller and cut short by none of them. */
  let fetching: Promise<EngineCatalogRefreshResult> | undefined

  const persist = async () => {
    if (state)
      await options.store
        ?.write(STORE_KEY, { schema: DOCUMENT_SCHEMA, ...state } satisfies StoredEntry)
        .catch(() => undefined)
  }

  const restore = async (): Promise<Omit<StoredEntry, 'schema'> | undefined> => {
    const entry = (await options.store?.read(STORE_KEY).catch(() => undefined)) as
      | Partial<StoredEntry>
      | undefined
    if (!entry) return undefined
    const document = entry.schema === DOCUMENT_SCHEMA ? readDocument(entry.document) : undefined
    if (!document) {
      options.onDropped?.(
        STORE_KEY,
        entry.schema === DOCUMENT_SCHEMA ? 'not a catalog document' : 'an older format',
      )
      return undefined
    }
    return {
      fetchedAt: entry.fetchedAt ?? 0,
      ...(entry.etag ? { etag: entry.etag } : {}),
      digest: entry.digest ?? digestOf(document),
      document,
    }
  }

  /** Loads once: the stored copy, else the shipped snapshot (stored as stale, so the next check fetches). */
  const load = async () => {
    state = await restore()
    if (state) return
    const document = normalize((await loadSnapshot()).providers)
    state = { fetchedAt: 0, digest: digestOf(document), document }
    await persist()
  }

  /** The current state; refreshes replace it after the first load. */
  const ready = async () => {
    await (loading ??= load())
    return state!
  }

  const providers = async (): Promise<ServedProvider[]> => {
    const { document } = await ready()
    const records = Object.values(document)
    return options.local ? [...records, localProvider(options.local)] : records
  }

  const project = async (): Promise<EngineCatalog> => {
    const served = await providers()
    const oauthProviders = served.flatMap((provider) => {
      const login = OAUTH_LOGINS[provider.id]
      return login
        ? [
            {
              providerId: provider.id,
              loginLabel: login.loginLabel,
              loginDescription: `Authenticate with ${login.name}`,
            },
          ]
        : []
    })
    return {
      providers: served.map(listedProvider),
      models: served.flatMap((provider) => [
        ...Object.values(provider.chat).map((model) => listedModel(provider, model, 'chat')),
        ...Object.values(provider.decision).map((model) =>
          listedModel(provider, model, 'decision'),
        ),
      ]),
      oauthProviderIds: oauthProviders.map((provider) => provider.providerId),
      oauthProviders,
    }
  }

  const fetchNow = async (
    current: Omit<StoredEntry, 'schema'>,
  ): Promise<EngineCatalogRefreshResult> => {
    try {
      const outcome = await fetchModelsDev({
        ...(current.etag ? { etag: current.etag } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
      const fetchedAt = Date.now()
      if (outcome.status === 'unchanged') {
        state = { ...current, fetchedAt }
        await persist()
        return { changed: false, aborted: false, errors: [] }
      }
      const document = normalize(outcome.providers)
      if (Object.keys(document).length === 0)
        throw new Error('models.dev sent something that is not its catalog')
      const digest = digestOf(document)
      const changed = digest !== current.digest
      state = {
        fetchedAt,
        ...(outcome.etag ? { etag: outcome.etag } : {}),
        digest,
        document: changed ? document : current.document,
      }
      if (changed) {
        generation++
        projection = undefined
      }
      await persist()
      return { changed, aborted: false, errors: [] }
    } catch (error) {
      return {
        changed: false,
        aborted: false,
        errors: [
          {
            providerId: STORE_KEY,
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      }
    }
  }

  /** The shared check, or an aborted result as soon as this caller's own signal fires. */
  const awaitFor = (
    shared: Promise<EngineCatalogRefreshResult>,
    signal: AbortSignal | undefined,
  ): Promise<EngineCatalogRefreshResult> => {
    if (!signal) return shared
    const aborted = { changed: false, aborted: true, errors: [] }
    if (signal.aborted) return Promise.resolve(aborted)
    return new Promise((resolve) => {
      const onAbort = () => resolve(aborted)
      signal.addEventListener('abort', onAbort, { once: true })
      void shared.then(resolve).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  const check = async (
    refresh: EngineCatalogRefreshOptions,
  ): Promise<EngineCatalogRefreshResult> => {
    const current = await ready()
    if (!refresh.allowNetwork || (!refresh.force && Date.now() - current.fetchedAt < FRESH_MS)) {
      return { changed: false, aborted: false, errors: [] }
    }
    fetching ??= fetchNow(current).finally(() => (fetching = undefined))
    return awaitFor(fetching, refresh.signal)
  }

  return {
    async list(): Promise<EngineCatalog> {
      if (projection) return structuredClone(projection)
      const started = generation
      const projected = await project()
      // An invalidation that landed while projecting wins: the next read projects again.
      if (started === generation) projection = projected
      return structuredClone(projected)
    },

    /** The host's own list changed (local models): the next `list()` projects again. */
    invalidate() {
      generation++
      projection = undefined
    },

    refresh(refresh: EngineCatalogRefreshOptions): Promise<EngineCatalogRefreshResult> {
      return check(refresh)
    },

    /**
     * How to reach one model, or undefined when this engine does not serve it. The kind is the
     * caller's: a run asks for a chat model, a decision for a decision model, and one id may be both.
     */
    async resolve(
      ref: RuntimeModelRef,
      kind: 'chat' | 'decision' = 'chat',
    ): Promise<CatalogEntry | undefined> {
      const provider = (await providers()).find((record) => record.id === ref.providerId)
      const model = provider?.[kind][ref.modelId]
      if (!provider || !model) return undefined
      return {
        provider: {
          id: provider.id,
          name: provider.name,
          ...(provider.route.baseURL ? { baseURL: provider.route.baseURL } : {}),
          ...(OAUTH_LOGINS[provider.id] ? { oauth: OAUTH_LOGINS[provider.id] } : {}),
          local: provider.id === LOCAL_PROVIDER_ID,
        },
        route: model.route,
        model: { ...model, kind, api: kind === 'decision' ? 'decisions' : wireOf(model.route) },
      }
    },
  }
}

export type ModelCatalog = ReturnType<typeof createModelCatalog>
