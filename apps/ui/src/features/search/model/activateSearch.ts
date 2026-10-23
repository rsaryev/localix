import { invokeUi, type UiNavigationHost } from '@/shared/lib/uiNavigation'
import { parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

/**
 * Registry-first UI-anchor activation. Search and `/open` share this entry point;
 * mini-app-specific navigation stays behind the anchor registry, while core URI
 * schemes fall through to the injected navigators.
 */
/** Global-search adapter over the shared UI-anchor activation seam. */
export function activateSearchHit(
  hit: { id: string; uri?: string; domain?: string },
  navigation: UiNavigationHost,
): boolean {
  const uri = hit.uri ?? hit.id
  const parsed = parseLocalixUri(uri)
  const trustedWriteCommand =
    hit.domain === 'commands' &&
    parsed?.primitive === 'ui' &&
    parsed.breadcrumbs.length === 3 &&
    parsed.breadcrumbs[0] === 'action' &&
    parsed.breadcrumbs[1] === 'command'
  return invokeUi(uri, navigation, trustedWriteCommand ? { allowWrite: true } : {})
}
