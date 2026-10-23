/**
 * Context Fabric adapter for `localix://resource/api` requests — what makes an `@`-mentioned request land in the
 * model's context automatically, rather than only being expandable on demand.
 *
 * The provider is NOT passed: the factory derives it from the expander, which is this mini app's
 * own `ResourceRefProvider` and therefore the authority on the namespace it owns.
 *
 * SENSITIVITY: `project`, the factory's default, is the honest label. A saved request is not
 * `public` — its url and headers describe a private API, and a `${secret:KEY}` reference names a
 * key that exists. It is not secret either: `redactSpec` has already removed every literal
 * credential before an expansion is built, so what the fabric can capture is a description of a
 * request, never the means to make one.
 */

import type { ContextProviderContribution } from '@localixai/mini-app-sdk/backend'
import { createResourceContextProvider } from '@localixai/mini-app-sdk/backend'
import { createRestResourceProvider, type ResourceRequestPort } from './resource-provider'

export function createRestContextProvider(port: ResourceRequestPort): ContextProviderContribution {
  return createResourceContextProvider({
    id: 'api:requests-context',
    namespace: 'api-requests',
    kind: () => 'api-request',
    revisionPrefix: 'api-request-content',
    sensitivity: 'project',
    expander: createRestResourceProvider(port),
    // An expansion is one cached local file read and a redact — orders of magnitude inside the
    // factory's 1.5s local-read default, so it is left alone. (Trading raises it because its
    // expansion is a live exchange round-trip; ours has no such excuse and should not borrow one.)
    //
    // The 2k-token default quota is likewise right here: a request description is a handful of
    // headers, not a market table. A request that somehow exceeded it would be one whose body is
    // enormous, and truncating that is correct.
  })
}
