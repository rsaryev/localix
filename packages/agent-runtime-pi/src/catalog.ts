import {
  createModels,
  getSupportedThinkingLevels,
  type Models,
  type Provider,
} from '@earendil-works/pi-ai'

import type { CatalogModel, CatalogProvider } from '@localixai/agent/catalog'
import type {
  EngineCatalog,
  EngineCatalogRefreshOptions,
  EngineCatalogRefreshResult,
  EngineCatalogStore,
} from '@localixai/agent/runtime'

import { createPiModelsStore } from './catalog-store'
import { createPiModelsCollection, credentialOnlyAuthContext, piProviders } from './providers'

/** The engine-neutral projection of a pi collection's current providers and chat models. */
function projectPiCatalog(models: Models): EngineCatalog {
  const modelCountByProvider = new Map<string, number>()
  for (const model of models.getModels()) {
    modelCountByProvider.set(model.provider, (modelCountByProvider.get(model.provider) ?? 0) + 1)
  }
  const providers: CatalogProvider[] = models.getProviders().map((provider) => ({
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
    // pi's own answer, `off` included exactly where pi can send no reasoning; the runtime clamps
    // with pi's `clampThinkingLevel` over the same list. A model that does not reason lists `off`.
    reasoningEfforts: getSupportedThinkingLevels(model),
    api: model.api,
    supportsAttachment: model.input.includes('image'),
    inputModalities: [...model.input],
    outputModalities: ['text'],
    contextLength: model.contextWindow,
    outputLimit: model.maxTokens,
    cost: { ...model.cost },
    // pi's release date (models.dev / OpenRouter / AI Gateway); the catalog service orders
    // newest-first on it.
    ...(model.releaseDate ? { releaseDate: model.releaseDate } : {}),
  }))
  // Decision models (pi's `classifier` type, OpenRouter's `output_modalities: decisions`): they
  // answer typed questions and write no text, so they list as their own kind.
  const decisionModels: CatalogModel[] = models.getModelsOfType('classifier').map((model) => ({
    id: `${model.provider}/${model.id}`,
    kind: 'decision',
    providerId: model.provider,
    providerName: providerNames.get(model.provider) ?? model.provider,
    name: model.name,
    supportsTools: false,
    supportsReasoning: false,
    api: model.api,
    supportsAttachment: model.input.includes('image'),
    inputModalities: [...model.input],
    outputModalities: ['decisions'],
    contextLength: model.contextWindow,
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
  return {
    providers,
    models: [...chatModels, ...decisionModels],
    oauthProviderIds: oauthProviders.map((provider) => provider.providerId),
    oauthProviders,
  }
}

function cloneCatalog(catalog: EngineCatalog): EngineCatalog {
  return {
    providers: catalog.providers.map((provider) => ({ ...provider })),
    models: catalog.models.map((model) => ({
      ...model,
      inputModalities: [...model.inputModalities],
      outputModalities: [...model.outputModalities],
      ...(model.reasoningEfforts ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
      ...(model.cost
        ? {
            cost: {
              ...model.cost,
              ...(model.cost.tiers ? { tiers: model.cost.tiers.map((tier) => ({ ...tier })) } : {}),
            },
          }
        : {}),
    })),
    oauthProviderIds: [...catalog.oauthProviderIds],
    oauthProviders: catalog.oauthProviders.map((provider) => ({ ...provider })),
  }
}

/** The current catalog of the process's shared providers, projected on every call. */
export async function listPiCatalog(): Promise<EngineCatalog> {
  return projectPiCatalog(createPiModelsCollection())
}

export interface PiCatalogOptions {
  /** Where refreshed catalogs persist between launches. Without it they last for the process. */
  store?: EngineCatalogStore
  /** The providers to list and refresh. Default: the process's shared built-ins. */
  providers?: readonly Provider[]
  /** A persisted entry was dropped instead of restored (unreadable, invalid, or another build's). */
  onDropped?: (providerId: string, reason: string) => void
}

/**
 * The engine's catalog: pi's providers in one long-lived collection whose dynamic providers are
 * refreshed through pi's `Models.refresh()`. The projection is built once and rebuilt only after a
 * refresh reports that a provider published a new list.
 */
export function createPiCatalog(options: PiCatalogOptions = {}) {
  const models = createModels({
    authContext: credentialOnlyAuthContext,
    ...(options.store
      ? { modelsStore: createPiModelsStore(options.store, { onDropped: options.onDropped }) }
      : {}),
  })
  const providers = options.providers ?? piProviders()
  for (const provider of providers) models.setProvider(provider)
  // Only the public generated catalogs. Radius's list is per account and is not the host's to
  // refresh from a catalog that no credential stands behind.
  const refreshable = providers
    .filter((provider) => provider.refreshWithoutAuth)
    .map((provider) => provider.id)
  let projection: EngineCatalog | undefined

  return {
    async list(): Promise<EngineCatalog> {
      projection ??= projectPiCatalog(models)
      return cloneCatalog(projection)
    },

    /** A host-owned provider's list changed; the next `list()` projects again. */
    invalidate() {
      projection = undefined
    },

    async refresh(refresh: EngineCatalogRefreshOptions): Promise<EngineCatalogRefreshResult> {
      const result = await models.refresh({
        allowNetwork: refresh.allowNetwork,
        providers: refreshable,
        ...(refresh.force ? { force: true } : {}),
        ...(refresh.signal ? { signal: refresh.signal } : {}),
      })
      if (result.updated.length > 0) projection = undefined
      return {
        changed: result.updated.length > 0,
        aborted: result.aborted,
        errors: [...result.errors].map(([providerId, error]) => ({
          providerId,
          message: error.message,
        })),
      }
    },
  }
}

export type PiCatalog = ReturnType<typeof createPiCatalog>
