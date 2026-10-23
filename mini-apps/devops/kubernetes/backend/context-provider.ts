import type { ContextProviderContribution } from '@localixai/mini-app-sdk/backend'
import { createResourceContextProvider } from '@localixai/mini-app-sdk/backend'
import {
  createKubernetesResourceProvider,
  type ResourceKubernetesService,
} from './resource-provider'

/**
 * Explicit-only Kubernetes context. Cluster reads are captured once and replayed from
 * persisted content, so a regenerate cannot silently observe a later cluster state —
 * a guarantee the shared factory now owns. Kubernetes-specific URI parsing and reads
 * stay inside this mini app, behind its read-only resource provider.
 *
 * `namespace` is `kubernetes` while the resource provider is `k8s`: emitted artefacts are
 * named for the domain, while resource dispatch uses the provider id. Only the namespace is
 * declared here — the provider is derived from the expander, which is this mini app's own
 * `ResourceRefProvider` and therefore the authority on its provider namespace.
 */
export function createKubernetesContextProvider(
  service: ResourceKubernetesService,
): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'devops:kubernetes-context',
    namespace: 'kubernetes',
    expander: createKubernetesResourceProvider(service),
  })
}
