import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { backendClient } from '@/shared/api/client'

/**
 * Persist the session's pinned-skill snapshot inside the same project-scoped
 * preflight used by every other agent capability mutation. A send started in
 * the same turn therefore cannot build its prompt from the previous skill set.
 */
export function persistPinnedSkills(
  sessionId: string,
  names: readonly string[],
  projectId: string | null,
) {
  return trackCapabilityWrite(projectId, () =>
    backendClient.setSessionSkills(sessionId, [...names]),
  )
}
