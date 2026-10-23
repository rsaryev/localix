/**
 * The search-provider registry now lives in `@localixai/mini-app-sdk/backend` so
 * mini apps consume it from the SDK instead of deep-importing this host path. This
 * file re-exports it to keep the host's existing internal import path working.
 */
export { createSearchProviderRegistry, selectProviders } from '@localixai/mini-app-sdk/backend'
export type {
  Problem,
  SearchHit,
  SearchProvider,
  SearchProviderRegistry,
  SearchQuery,
} from '@localixai/mini-app-sdk/backend'
