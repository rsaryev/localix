import type { CatalogModel, CatalogProvider } from './types'

/**
 * Whether connecting this provider can give the user anything to chat with.
 *
 * `modelCount` counts CHAT models only, and a provider can list none — one that serves only
 * classifiers (`typesafe`), say. Offering it for connection took a key and then showed an empty
 * model list. One rule for every list that offers a provider (the picker, onboarding), so they
 * cannot disagree about which providers exist.
 */
export function providerOffersChat(provider: Pick<CatalogProvider, 'modelCount'>): boolean {
  return provider.modelCount > 0
}

/** Minimal connection identity needed to resolve a provider-scoped model id. */
export interface CatalogModelConnection {
  id: string
  providerId: string
}

/**
 * Resolve catalog metadata by its real identity: provider + provider-native model id.
 * Catalogs may store either `model` or `<provider>/model`, while persisted selections
 * may use the other form. Model ids alone are not unique across providers.
 */
export function findCatalogModel<T extends Pick<CatalogModel, 'id' | 'providerId'>>(
  models: readonly T[],
  providerId: string | null | undefined,
  modelId: string | null | undefined,
): T | undefined {
  if (!modelId) return undefined
  const inferredProviderId =
    providerId ?? models.find((model) => modelId.startsWith(`${model.providerId}/`))?.providerId
  const matches = models.filter((model) => {
    if (inferredProviderId && model.providerId !== inferredProviderId) return false
    const nativeModelId = modelId.startsWith(`${model.providerId}/`)
      ? modelId.slice(model.providerId.length + 1)
      : modelId
    const candidateId = model.id.startsWith(`${model.providerId}/`)
      ? model.id.slice(model.providerId.length + 1)
      : model.id
    return candidateId === nativeModelId
  })
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Resolve a persisted connection+model pair without assuming model ids are
 * globally unique. Several providers expose the same ids (for example proxied
 * OpenAI-compatible catalogs), so the connection's provider is authoritative.
 */
export function findCatalogModelForConnection(
  models: readonly CatalogModel[],
  connections: readonly CatalogModelConnection[],
  connectionId: string | null | undefined,
  modelId: string | null | undefined,
): CatalogModel | undefined {
  if (!connectionId || !modelId) return undefined
  const providerId = connections.find((connection) => connection.id === connectionId)?.providerId
  if (!providerId) return undefined
  return findCatalogModel(models, providerId, modelId)
}
