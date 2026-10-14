import type { ContextProviderContribution } from '@localixai/plugin-sdk/backend'
import { createResourceContextProvider } from '@localixai/plugin-sdk/backend'
import { createDockerResourceProvider, type ResourceDockerService } from './resource-provider'

/**
 * Plugin-owned explicit resolver for Docker introspection. The core knows only the
 * generic Context Fabric contract; Docker's URI grammar and reads remain here, behind
 * the plugin's own read-only resource provider. The shared factory owns the revisioning
 * and the capture-then-replay contract, so a captured expansion is replayed from the
 * persisted snapshot rather than re-queried against a mutable daemon on regenerate.
 *
 * The provider is NOT passed: the factory derives it from the expander, which is the
 * plugin's own `ResourceRefProvider` and therefore the authority on its provider namespace.
 */
export function createDockerContextProvider(
  service: ResourceDockerService,
): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'devops:docker-context',
    namespace: 'docker',
    expander: createDockerResourceProvider(service),
  })
}
