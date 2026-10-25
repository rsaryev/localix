import type { Listing } from '@localixai/store'
import { railViewletRegistry } from '@/shared/contrib/uiContrib'

/**
 * Where an installed mini app opens: the screen it put in the rail, by the address the rail
 * registers for it. A mini app with no screen of its own (agent tools only) has nothing to open.
 */
export function openInstalledMiniApp(listing: Listing): string | undefined {
  if (listing.ref.kind !== 'mini-app') return undefined
  const viewlet = railViewletRegistry.list().find((entry) => entry.miniAppName === listing.ref.id)
  return viewlet ? `localix://ui/work-item/viewlet/${encodeURIComponent(viewlet.kind)}` : undefined
}
