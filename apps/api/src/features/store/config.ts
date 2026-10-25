import type {
  ConfigValue,
  ListingConfig,
  ListingRef,
  Scope,
  StoreActor,
  StoreProvider,
} from '@localixai/store'

import { ConflictError, NotFoundError } from '../../lib/domain-errors'

const unsupported = (ref: ListingRef) =>
  new ConflictError('store_unsupported', `${ref.kind} packages have no settings to change here`)

/** One install's settings, from the provider that stores them. */
export async function configOf(
  provider: StoreProvider,
  ref: ListingRef,
  scope: Scope,
  actor: StoreActor,
): Promise<ListingConfig> {
  if (!provider.config) throw unsupported(ref)
  const config = await provider.config(ref.id, scope, actor)
  if (!config)
    throw new NotFoundError('store_config_not_found', `${ref.id} has no settings in ${scope}`)
  return config
}

/** Saves some of one install's settings through the provider that stores them. */
export async function saveConfig(
  provider: StoreProvider,
  ref: ListingRef,
  scope: Scope,
  values: Record<string, ConfigValue>,
  actor: StoreActor,
): Promise<void> {
  if (!provider.setConfig) throw unsupported(ref)
  await provider.setConfig(ref.id, scope, values, actor)
}

/** The service's two settings operations, over whichever provider owns the kind. */
export const configService = (providerOf: (kind: ListingRef['kind']) => StoreProvider) => ({
  config: (ref: ListingRef, scope: Scope, actor: StoreActor) =>
    configOf(providerOf(ref.kind), ref, scope, actor),
  setConfig: (
    ref: ListingRef,
    scope: Scope,
    values: Record<string, ConfigValue>,
    actor: StoreActor,
  ) => saveConfig(providerOf(ref.kind), ref, scope, values, actor),
})
