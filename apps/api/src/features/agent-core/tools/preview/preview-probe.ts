/**
 * Preview serving — the entry point the rest of the API talks to.
 *
 * Three cooperating pieces, each in its own module because each changes for its
 * own reason:
 *
 *  - `probe-inject.ts`   the visual-feedback probe: bundle it once with `Bun.build`
 *                        (dev-watch-aware cache) and inject it inline into HTML.
 *  - `preview-static.ts` serve a directory the agent wrote files into, probe injected.
 *  - `preview-proxy.ts`  reverse-proxy a dev server we DON'T serve (Vite/Next/…),
 *                        injecting the probe into HTML on the way through.
 *
 * The only thing that belongs at this level is what spans them: shutting both
 * server pools down together.
 */

export { getPreviewProbeJs, getNativeBrowserProbeJs, warmPreviewProbe } from './probe-inject'
export { ensureStaticServer } from './preview-static'
export { buildInjectedPreviewUrl } from './preview-proxy'

import { disposeProxyServers } from './preview-proxy'
import { disposeStaticServers } from './preview-static'

/** Stop the cached preview static + injecting-proxy servers — graceful shutdown so the
 *  process releases their ports promptly instead of relying on process exit. */
export function disposePreviewServers(): void {
  disposeStaticServers()
  disposeProxyServers()
}
