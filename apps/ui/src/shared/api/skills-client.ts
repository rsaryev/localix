import { client, unwrap } from './internal'
import { toUiSession } from './converters'
import type { UiSession } from './contracts'

/**
 * Skills: per-session skill pinning. A skill is written,
 * edited, archived and removed through the Store; its list rides in the capability snapshot as
 * summaries. Spread into `backendClient`.
 */
export const skillsApi = {
  async setSessionSkills(sessionId: string, names: string[]): Promise<UiSession> {
    const json = await unwrap(
      await client.rpc.sessions[':id'].skills.$post({
        param: { id: sessionId },
        json: { skills: names },
      }),
    )
    return toUiSession(json)
  },
}
