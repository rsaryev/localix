/**
 * @localixai/engine-models — model access: the models.dev catalog, the provider SDKs
 * (`@ai-sdk/*`), sign-in and credentials, and the `ModelSession` a run streams through.
 *
 * Knows providers, wire formats and prices; knows nothing about turns, tools or the host.
 */
export { createAuth } from './auth/auth'
export { createModelCatalog } from './catalog/catalog'
export { OAUTH_LOGINS } from './catalog/families'
export { createLanguageModelFactory, LanguageModelCompletionError } from './language-models'
export { openSession, PreflightRejection, type ModelAccessOptions } from './model-access'
export type { RetryPolicy } from './retry'
export { StreamIdleTimeoutError, type SilenceDeadline } from './session'
