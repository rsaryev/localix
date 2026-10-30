import { apiVersionTooNew } from '../ext/manifest-validate'
import { MINI_APP_API_VERSION } from './contracts-base'
import type { DiscoveredMiniApp } from './folder'

/**
 * May this host RUN this mini app's code — and if not, why?
 *
 * A manifest error blocks it, so does its marketplace taking it back (`revocations.ts`), and so
 * does an `apiVersion` newer than this host implements: a mini
 * app built against a future SDK used to be imported anyway and failed in whatever way its
 * missing contract happened to fail. Every path that imports mini app code asks this. Returns the
 * reason to show, or null. A manifest declaring no `apiVersion` is assumed compatible.
 */
export function miniAppLoadBlockReason(app: DiscoveredMiniApp): string | null {
  if (app.error) return app.error
  if (app.revoked) return `Its marketplace took it back: ${app.revoked}`
  return apiVersionTooNew('Mini app', MINI_APP_API_VERSION, app.manifest?.apiVersion)
}
