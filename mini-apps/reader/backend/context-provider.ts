import {
  createResourceContextProvider,
  type ContextProviderContribution,
  type ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'

export function createReaderContextProvider(
  resourceProvider: ResourceRefProvider,
): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'reader:context',
    namespace: 'reader',
    revisionPrefix: 'reader-source',
    sensitivity: 'project',
    maxTokens: 8_000,
    timeoutMs: 5_000,
    expander: resourceProvider,
  })
}
