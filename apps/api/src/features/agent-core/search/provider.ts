/**
 * The search-provider registry now lives in `@localixai/plugin-sdk/backend` so
 * plugins consume it from the SDK instead of deep-importing this host path. This
 * file re-exports it to keep the host's existing internal import path working.
 */
export {
  PROVIDER_TIMEOUT_MS,
  createSearchProviderRegistry,
  selectProviders,
} from '@localixai/plugin-sdk/backend'
export type {
  Problem,
  SearchFanOut,
  SearchHit,
  SearchProvider,
  SearchProviderAnswer,
  SearchProviderRegistry,
  SearchProviderResult,
  SearchQuery,
} from '@localixai/plugin-sdk/backend'
