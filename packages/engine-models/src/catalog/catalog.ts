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

import type { CatalogProvider } from '@localixai/agent/catalog'
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

function localProvider(host: LocalProviderHost): ServedProvider {
  const route: Route = { family: 'openai-compatible', baseURL: 'http://127.0.0.1/v1' }
  const chat: Record<string, ServedModel> = {}
  for (const model of host.models()) {
    chat[model.id] = {
      id: model.id,
      name: model.name,
      route,
      input: model.vision ? ['text', 'image'] : ['text'],
      output: ['text'],
      attachment: model.vision,
      tools: true,
      reasons: model.reasoning,
      reasoning: model.reasoning ? ['off', 'low', 'medium', 'high'] : [],
      temperature: true,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxTokens,
      cost: { input: 0, output: 0 },
    }
  }
  return { id: LOCAL_PROVIDER_ID, name: 'Local', env: [], route, chat, decision: {} }
}

function listedProvider(provider: ServedProvider): CatalogProvider {
  return {
    id: provider.id,
    name: provider.name,
    modelCount: Object.keys(provider.chat).length,
    authType: OAUTH_LOGINS[provider.id] && provider.env.length === 0 ? 'oauth-pkce' : 'api-key',
    ...(provider.route.baseURL ? { apiBaseUrl: provider.route.baseURL } : {}),
    ...(provider.doc ? { doc: provider.doc } : {}),
  }
}

export function createModelCatalog(options: ModelCatalogOptions = {}) {
  let state: Omit<StoredEntry, 'schema'> | undefined
  let loading: Promise<void> | undefined
  let projection: EngineCatalog | undefined
  /** A check in flight; a second caller waits for it instead of asking models.dev again. */
  let checking: Promise<EngineCatalogRefreshResult> | undefined

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

  const check = async (
    refresh: EngineCatalogRefreshOptions,
  ): Promise<EngineCatalogRefreshResult> => {
    const current = await ready()
    if (!refresh.allowNetwork || (!refresh.force && Date.now() - current.fetchedAt < FRESH_MS)) {
      return { changed: false, aborted: false, errors: [] }
    }
    try {
      const outcome = await fetchModelsDev({
        ...(current.etag ? { etag: current.etag } : {}),
        ...(refresh.signal ? { signal: refresh.signal } : {}),
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
      if (changed) projection = undefined
      await persist()
      return { changed, aborted: false, errors: [] }
    } catch (error) {
      if (refresh.signal?.aborted) return { changed: false, aborted: true, errors: [] }
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

  return {
    async list(): Promise<EngineCatalog> {
      projection ??= await project()
      return structuredClone(projection)
    },

    /** The host's own list changed (local models): the next `list()` projects again. */
    invalidate() {
      projection = undefined
    },

    refresh(refresh: EngineCatalogRefreshOptions): Promise<EngineCatalogRefreshResult> {
      checking ??= check(refresh).finally(() => (checking = undefined))
      return checking
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
