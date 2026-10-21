import type { RuntimeCredential } from '@localixai/agent/runtime'
import { findCatalogModel, routeReadiness } from '@localixai/agent/catalog'

import { firstEnabledKey } from './provider-keys'
import type { RunnerDeps } from './agent-runner-types'
import type { createUserProfileRepository } from '../../user/repository'
import { DEFAULT_REASONING_EFFORT, type ReasoningEffort } from '@localixai/agent'

type Catalog = Awaited<ReturnType<RunnerDeps['catalogService']['getCatalog']>>

/**
 * Strip the `"<providerId>/"` namespace from a full catalog model id, leaving the
 * runtime-native model id the adapter expects. No-op when the id isn't namespaced.
 */
export function stripProviderPrefix(modelId: string, providerId: string): string {
  return hasProviderPrefix(modelId, providerId) ? modelId.slice(providerId.length + 1) : modelId
}

/** Whether a catalog model id carries the `"<providerId>/"` namespace. */
export function hasProviderPrefix(modelId: string, providerId: string): boolean {
  return modelId.startsWith(`${providerId}/`)
}

/** A connection can serve a run while one of its keys is enabled (a listing without keys: yes). */
function usableConnection(connection: { keys?: unknown }): boolean {
  const keys = connection.keys
  return !Array.isArray(keys) || keys.some((key: { enabled?: boolean }) => key.enabled !== false)
}

/** A LanguageModel must produce text (`complete`) or typed decisions (`decide`). Catalog entries
 * that explicitly advertise only image/media output can do neither, so they are refused. */
function servesLanguageModel(
  providerId: string,
  modelId: string,
  catalog?: Pick<Catalog, 'models'>,
): boolean {
  const model = catalog ? findCatalogModel(catalog.models, providerId, modelId) : undefined
  const modalities = model?.outputModalities
  return !modalities || modalities.includes('text') || modalities.includes('decisions')
}

/**
 * Verify a model selection belongs to the connection's provider. Exact catalog
 * metadata wins; live models (not present in the static catalog) must use their
 * `<providerId>/...` namespace. An unknown bare id has no durable owner and is
 * rejected instead of being guessed from an ephemeral connection id.
 */
export function providerOwnsModel(
  providerId: string,
  modelId: string,
  catalog?: Pick<Catalog, 'models'>,
): boolean {
  const catalogOwners = new Set(catalog?.models.map((model) => model.providerId) ?? [])
  const knownOwners = [...catalogOwners].filter((owner) =>
    findCatalogModel(catalog?.models ?? [], owner, modelId),
  )
  if (knownOwners.length > 0) {
    return knownOwners.includes(providerId)
  }
  if (!modelId.includes('/')) return false
  return hasProviderPrefix(modelId, providerId)
}

/**
 * Resolve a provider connection and model into the narrow LanguageModel port — the shared
 * connection sequence (requireConnection → ensureFreshKeys → catalog
 * entry → first enabled key → runtime factory) every auxiliary path
 * repeated. Fails open to `null` on any miss. Returns the catalog `entry` and
 * fresh `connection` too so callers can derive a provider id / strip the model
 * prefix without re-finding them. Pass `catalog` to reuse an already-fetched one.
 *
 * Deps subset typed via Pick so service-layer callers (which thread the same
 * services without the full RunnerDeps) can use it.
 */
export function toRuntimeCredential(key: {
  apiKey: string
  authType: 'api-key' | 'oauth'
  refreshToken?: string | null
  expiresAt?: string | null
}): RuntimeCredential {
  return key.authType === 'oauth' && key.refreshToken
    ? {
        type: 'oauth',
        accessToken: key.apiKey,
        refreshToken: key.refreshToken,
        expiresAt: key.expiresAt ? Date.parse(key.expiresAt) : Number.MAX_SAFE_INTEGER,
      }
    : { type: 'api-key', key: key.apiKey }
}

export async function resolveConnectionModel(params: {
  deps: Pick<RunnerDeps, 'providerConnectionsService' | 'catalogService' | 'languageModelFactory'>
  userId: string
  providerConnectionId: string
  modelId: string
  /** Expected provider identity, independent of the connection identifier. */
  providerId?: string
  catalog?: Catalog
}): Promise<{
  model: ReturnType<RunnerDeps['languageModelFactory']['create']>
  entry: Catalog['providers'][number]
  connection: Awaited<ReturnType<RunnerDeps['providerConnectionsService']['ensureFreshKeys']>>
  credential: ReturnType<typeof toRuntimeCredential>
  credentialId: string
  credentialStore: Awaited<
    ReturnType<RunnerDeps['providerConnectionsService']['credentialStoreFor']>
  >
  rawModelId: string
} | null> {
  try {
    const raw = await params.deps.providerConnectionsService.requireConnection(
      params.userId,
      params.providerConnectionId,
    )
    const connection = await params.deps.providerConnectionsService.ensureFreshKeys(
      params.userId,
      raw,
    )
    if (params.providerId !== undefined && connection.providerId !== params.providerId) return null
    const catalog = params.catalog ?? (await params.deps.catalogService.getCatalog())
    const entry = catalog.providers.find((p) => p.id === connection.providerId)
    if (!entry) return null
    if (!providerOwnsModel(entry.id, params.modelId, catalog)) return null
    if (!servesLanguageModel(entry.id, params.modelId, catalog)) return null
    const key = firstEnabledKey(connection.keys)
    if (!key) return null
    const rawModelId = stripProviderPrefix(params.modelId, entry.id)
    const credentialStore = await params.deps.providerConnectionsService.credentialStoreFor(
      params.userId,
      connection.id,
      key.id,
    )
    const credential = toRuntimeCredential(key)
    const model = params.deps.languageModelFactory.create(
      { providerId: entry.id, modelId: rawModelId },
      credential,
      credentialStore,
    )
    return {
      model,
      entry,
      connection,
      credential,
      credentialId: key.id,
      credentialStore,
      rawModelId,
    }
  } catch {
    return null
  }
}

/**
 * Agnostic model→provider resolution: build a working provider for a model
 * through ANY of the user's live connections that serve the model's provider —
 * the connection id is not identity, the (provider, model) pair is.
 *
 * A namespaced catalog model id (`<providerId>/…`) names its own provider, so a
 * persisted model choice keeps working after the user deletes and re-adds that
 * provider (which mints a brand-new connection id): we just pick another live
 * connection for the same provider. `preferredConnectionId` (the id we happened
 * to store) is tried FIRST as a hint — respecting the user's exact pick when it
 * is still valid — then every other same-provider connection. Returns null only
 * when the provider has no usable connection at all.
 *
 * This is the ONE resolver every "user chose a specific model" path should use
 * (workload routes, delegated task runs, the session model) so none of them dead-ends on a
 * stale connection id.
 */
export async function resolveLanguageModel(params: {
  deps: Pick<RunnerDeps, 'providerConnectionsService' | 'catalogService' | 'languageModelFactory'>
  userId: string
  modelId: string
  /** Explicit native provider identity. A connection hint cannot override it. */
  providerId?: string
  /** The stored/desired connection id, tried first when present. Advisory only. */
  preferredConnectionId?: string | null
  catalog?: Catalog
}): Promise<{
  model: ReturnType<RunnerDeps['languageModelFactory']['create']>
  entry: Catalog['providers'][number]
  connection: Awaited<ReturnType<RunnerDeps['providerConnectionsService']['ensureFreshKeys']>>
  credential: ReturnType<typeof toRuntimeCredential>
  credentialId: string
  credentialStore: Awaited<
    ReturnType<RunnerDeps['providerConnectionsService']['credentialStoreFor']>
  >
  rawModelId: string
  providerConnectionId: string
} | null> {
  const { modelId, preferredConnectionId } = params
  const { connections } = await params.deps.providerConnectionsService
    .listConnections(params.userId)
    .catch(() => ({ connections: [] as Array<{ id: string; providerId: string; keys?: unknown }> }))
  const catalog =
    params.catalog ?? (await params.deps.catalogService.getCatalog().catch(() => undefined))
  if (params.providerId !== undefined && !providerOwnsModel(params.providerId, modelId, catalog))
    return null

  // The provider and the account are decided by THE route rule (`routeReadiness`, C7): the stored
  // connection when it still serves the model, else another usable account of the model's one
  // provider; never a guess across providers. An explicit provider narrows the question to it.
  const explicit = params.providerId
  const routeConnections = connections
    .filter((c) => explicit === undefined || c.providerId === explicit)
    .map((c) => ({ id: c.id, providerId: c.providerId, usable: usableConnection(c) }))
  const models = (catalog?.models ?? []).filter(
    (model) => explicit === undefined || model.providerId === explicit,
  )
  const readiness = routeReadiness(
    { modelId, providerConnectionId: preferredConnectionId },
    routeConnections,
    models,
  )
  if (readiness.status !== 'ready') return null
  const { providerId } = readiness

  // The chosen account first; the provider's other usable accounts after it, for a credential
  // that fails to resolve.
  const orderedIds = [
    readiness.connectionId,
    ...routeConnections
      .filter((c) => c.providerId === providerId && c.usable && c.id !== readiness.connectionId)
      .map((c) => c.id),
  ]

  for (const id of orderedIds) {
    const resolved = await resolveConnectionModel({
      deps: params.deps,
      userId: params.userId,
      providerConnectionId: id,
      providerId,
      modelId,
      catalog,
    }).catch(() => null)
    if (resolved?.model) return { ...resolved, providerConnectionId: id }
  }
  return null
}

export async function resolveAuxiliaryModel(params: {
  deps: RunnerDeps
  userProfileRepo?: ReturnType<typeof createUserProfileRepository>
  userId: string
  slot:
    | { providerConnectionId?: string; modelId?: string; reasoningEffort?: ReasoningEffort }
    | null
    | undefined
  catalog: Catalog
}) {
  if (!params.slot?.providerConnectionId || !params.slot.modelId) return null
  const resolved = await resolveLanguageModel({
    deps: params.deps,
    userId: params.userId,
    modelId: params.slot.modelId,
    preferredConnectionId: params.slot.providerConnectionId,
    catalog: params.catalog,
  })
  if (!resolved) return null
  const catalogModel = findCatalogModel(
    params.catalog.models,
    resolved.entry.id,
    params.slot.modelId,
  )
  return {
    model: resolved.model,
    modelId: params.slot.modelId,
    providerId: resolved.entry.id,
    providerConnectionId: resolved.providerConnectionId,
    contextLength: catalogModel?.contextLength,
    outputLimit: catalogModel?.outputLimit,
    // A workload holds its own level; it never follows the conversation's.
    reasoningEffort: params.slot.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  }
}
