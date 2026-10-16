import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type {
  Credential,
  CredentialInfo,
  CredentialStore,
  ProviderAuth,
} from '@earendil-works/pi-ai'

import type {
  RuntimeCredential,
  RuntimeCredentialInfo,
  RuntimeCredentialStore,
  RuntimeModelRef,
} from '@localixai/agent/runtime'
import type { CatalogModel, CatalogProvider } from '@localixai/agent/catalog'

import { PiCredentialStoreAdapter, toPiCredential } from './auth'
import { createPiModelsCollection, publishedThinkingRevision } from './providers'
import { resolveCatalogMetadata, type PiCatalogOptions } from './catalog-metadata'

export type {
  CatalogMetadataSnapshot,
  CatalogMetadataStore,
  PiCatalogOptions,
} from './catalog-metadata'

class ScopedCredentialStore implements CredentialStore {
  private readonly providerId: string
  private credential: Credential

  constructor(providerId: string, credential: RuntimeCredential) {
    this.providerId = providerId
    this.credential = toPiCredential(credential)
  }

  async read(providerId: string): Promise<Credential | undefined> {
    return providerId === this.providerId ? this.credential : undefined
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [{ providerId: this.providerId, type: this.credential.type }]
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    if (providerId !== this.providerId) return undefined
    const next = await fn(this.credential)
    if (next !== undefined) this.credential = next
    return this.credential
  }

  async delete(providerId: string): Promise<void> {
    if (providerId === this.providerId) {
      throw new Error('A run-scoped credential cannot be deleted')
    }
  }
}

class SnapshotFallbackCredentialStore implements RuntimeCredentialStore {
  constructor(
    private readonly providerId: string,
    private readonly snapshot: RuntimeCredential,
    private readonly durable: RuntimeCredentialStore,
  ) {}

  async read(providerId: string): Promise<RuntimeCredential | undefined> {
    return (
      (await this.durable.read(providerId)) ??
      (providerId === this.providerId ? this.snapshot : undefined)
    )
  }

  async list(): Promise<readonly RuntimeCredentialInfo[]> {
    const entries = new Map((await this.durable.list()).map((entry) => [entry.providerId, entry]))
    if (!entries.has(this.providerId)) {
      entries.set(this.providerId, {
        providerId: this.providerId,
        type: this.snapshot.type,
      })
    }
    return [...entries.values()]
  }

  modify(
    providerId: string,
    update: (current: RuntimeCredential | undefined) => Promise<RuntimeCredential | undefined>,
  ): Promise<RuntimeCredential | undefined> {
    return this.durable.modify(providerId, (current) =>
      update(current ?? (providerId === this.providerId ? this.snapshot : undefined)),
    )
  }

  delete(providerId: string): Promise<void> {
    return this.durable.delete(providerId)
  }
}

export function createPiCredentialStore(
  model: RuntimeModelRef,
  credential: RuntimeCredential,
  credentialStore?: RuntimeCredentialStore,
): CredentialStore {
  return credentialStore
    ? new PiCredentialStoreAdapter(
        new SnapshotFallbackCredentialStore(model.providerId, credential, credentialStore),
      )
    : new ScopedCredentialStore(model.providerId, credential)
}

export function createPiModels(
  model: RuntimeModelRef,
  credential: RuntimeCredential,
  credentialStore?: RuntimeCredentialStore,
) {
  const credentials = createPiCredentialStore(model, credential, credentialStore)
  // A run resolves exactly one model. Keep the credential-bound collection
  // request-scoped, but register only the provider that can own that model.
  return createPiModelsCollection({ credentials }, model.providerId)
}

interface PiCatalogBase {
  providers: CatalogProvider[]
  models: CatalogModel[]
  oauthProviders: Array<{
    providerId: string
    loginLabel: string
    loginDescription: string
  }>
}

let catalogBase: PiCatalogBase | undefined
/** Which publish the memoised projection was built from — see `publishedThinkingRevision`. */
let catalogBaseRevision = -1

function getPiCatalogBase(): PiCatalogBase {
  if (catalogBase && catalogBaseRevision === publishedThinkingRevision()) return catalogBase
  catalogBaseRevision = publishedThinkingRevision()
  const models = createPiModelsCollection()
  const providerById = new Map<
    string,
    { id: string; name: string; baseUrl?: string; auth: ProviderAuth }
  >(models.getProviders().map((provider) => [provider.id, provider] as const))
  const modelCountByProvider = new Map<string, number>()
  for (const model of models.getModels()) {
    modelCountByProvider.set(model.provider, (modelCountByProvider.get(model.provider) ?? 0) + 1)
  }
  const providers: CatalogProvider[] = [...providerById.values()].map((provider) => ({
    id: provider.id,
    name: provider.name,
    modelCount: modelCountByProvider.get(provider.id) ?? 0,
    authType: provider.auth.oauth && !provider.auth.apiKey ? 'oauth-pkce' : 'api-key',
    ...(provider.baseUrl ? { apiBaseUrl: provider.baseUrl } : {}),
  }))
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]))
  const chatModels: CatalogModel[] = models.getModels().map((model) => ({
    id: `${model.provider}/${model.id}`,
    providerId: model.provider,
    providerName: providerNames.get(model.provider) ?? model.provider,
    name: model.name,
    supportsTools: true,
    supportsReasoning: model.reasoning,
    // What the model actually offers, from pi's own answer — `off` dropped, since asking for
    // no reasoning needs no support. A stored preference outlives the model it was chosen
    // for, so the picker has to know which levels are real before offering them.
    reasoningEfforts: model.reasoning
      ? getSupportedThinkingLevels(model).filter((level) => level !== 'off')
      : [],
    api: model.api,
    supportsAttachment: model.input.includes('image'),
    inputModalities: [...model.input],
    outputModalities: ['text'],
    contextLength: model.contextWindow,
    outputLimit: model.maxTokens,
    cost: { ...model.cost },
  }))
  const oauthProviders = models.getProviders().flatMap((provider) =>
    provider.auth.oauth
      ? [
          {
            providerId: provider.id,
            loginLabel: provider.auth.oauth.loginLabel ?? provider.auth.oauth.name,
            loginDescription: `Authenticate with ${provider.auth.oauth.name}`,
          },
        ]
      : [],
  )
  catalogBase = {
    providers,
    models: chatModels,
    oauthProviders,
  }
  return catalogBase
}

function cloneCatalogModel(model: CatalogModel, releaseDate?: string): CatalogModel {
  return {
    ...model,
    inputModalities: [...model.inputModalities],
    outputModalities: [...model.outputModalities],
    ...(model.cost
      ? {
          cost: {
            ...model.cost,
            ...(model.cost.tiers ? { tiers: model.cost.tiers.map((tier) => ({ ...tier })) } : {}),
          },
        }
      : {}),
    ...(releaseDate ? { releaseDate } : {}),
  }
}

/** Which metadata publish {@link listPiCatalog} would answer from — a host keys its cache on it. */
export { catalogMetadataRevision as piCatalogRevision } from './catalog-metadata'

export async function listPiCatalog(options: PiCatalogOptions = {}) {
  // Metadata FIRST: the base catalog reads each model's levels as it builds, and it is memoised,
  // so building it before the persisted answer was published would freeze the generated one in.
  // Never awaited on the network — a refresh that lands later bumps `piCatalogRevision`.
  const releaseDates = resolveCatalogMetadata(options)
  const base = getPiCatalogBase()
  return {
    providers: base.providers.map((provider) => ({ ...provider })),
    models: base.models.map((model) => cloneCatalogModel(model, releaseDates.get(model.id))),
    oauthProviderIds: base.oauthProviders.map((provider) => provider.providerId),
    oauthProviders: base.oauthProviders.map((provider) => ({ ...provider })),
  }
}
