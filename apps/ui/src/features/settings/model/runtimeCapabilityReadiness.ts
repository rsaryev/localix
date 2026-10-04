import { waitForCapabilityWrites } from '@/shared/contrib/capabilityWrites'
import { useSettingsStore } from './settingsStore'

/**
 * Resolve the persistence that can still change what the next agent run receives.
 *
 * TWO barriers, not four: every capability write — switches, installs, removals,
 * creations — registers with `capabilityWrites`, and the user profile carries the
 * no-project settings that are not capabilities. The tool-switch queue used to hold a
 * third barrier of its own, from when tool availability was written through settings
 * rather than through the capability endpoint; its sends are tracked like every other
 * write now, so waiting on it separately would only be waiting twice.
 *
 * A known project is isolated to its own scope; an unknown scope conservatively waits
 * for every active write.
 */
export function waitForRuntimeCapabilities(
  projectId: string | null | undefined,
): Promise<void> | null {
  const profile =
    projectId === null || projectId === undefined
      ? useSettingsStore.getState().flushIfPending()
      : null
  const capabilities = waitForCapabilityWrites(projectId)

  if (profile === null) return capabilities
  if (capabilities === null) return profile
  return Promise.all([profile, capabilities]).then(() => undefined)
}
