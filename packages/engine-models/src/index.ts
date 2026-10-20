/**
 * @localixai/engine-models — model access: the models.dev catalog, the provider SDKs
 * (`@ai-sdk/*`), sign-in and credentials, and the `ModelSession` a run streams through.
 *
 * Knows providers, wire formats and prices; knows nothing about turns, tools or the host.
 */
export { createAuth, type AuthOptions } from './auth/auth'
export {
  createModelCatalog,
  type CatalogEntry,
  type ModelCatalog,
  type ModelCatalogOptions,
} from './catalog/catalog'
export { OAUTH_LOGINS, type ProviderFamily, type Route } from './catalog/families'
export { reasoningLevels } from './catalog/model-facts'
export {
  normalize,
  type CatalogDocument,
  type ServedModel,
  type ServedProvider,
} from './catalog/normalize'
export { createLanguageModelFactory, LanguageModelCompletionError } from './language-models'
export {
  assertServable,
  openSession,
  PreflightRejection,
  reasoningFor,
  resolveEntry,
  type ModelAccessOptions,
  type OpenSessionInput,
} from './model-access'
export { DEFAULT_RETRY_POLICY, type RetryPolicy } from './retry'
export { DEFAULT_SILENCE, StreamIdleTimeoutError, type SilenceDeadline } from './session'
