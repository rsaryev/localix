/**
 * The search-provider registry now lives in `@localixai/plugin-sdk/backend` so
 * plugins consume it from the SDK instead of deep-importing this host path. This
 * file re-exports it to keep the host's existing internal import path working.
 */
export { createSearchProviderRegistry, selectProviders } from '@localixai/plugin-sdk/backend'
export type {
  Problem,
  SearchHit,
  SearchProvider,
  SearchProviderRegistry,
  SearchQuery,
} from '@localixai/plugin-sdk/backend'
