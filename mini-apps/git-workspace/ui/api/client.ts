import { hc } from 'hono/client'
// The SDK transport, not the host's API internals: a mini app owns its own client and must not
// reach into `shared/api` for the base URL, the envelope reader or the query cleaner.
import { miniAppApiUrl } from '@localixai/mini-app-sdk/ui'
import type { SourceControlRoutes } from '../../backend/source-control/routes'

/**
 * The typed RPC client every call in `api/` shares.
 *
 * Built LAZILY, on first call rather than at module load. `miniAppApiUrl` reads the transport the
 * HOST binds, and a mini app module is imported during discovery — which can run before that
 * binding, and does under SSR and in tests. Constructing at module scope therefore threw "Mini app
 * UI transport is not bound by the host" while the module was still evaluating, so `registerUi`
 * never ran and the mini app contributed nothing. The previous constant base URL hid this because
 * it needed no host at all.
 */
let routeClient: ReturnType<typeof hc<SourceControlRoutes>> | undefined
const rpc = () => (routeClient ??= hc<SourceControlRoutes>(miniAppApiUrl('/rpc/source-control')))

export const client = {
  rpc: {
    get 'source-control'() {
      return rpc()
    },
  },
}
