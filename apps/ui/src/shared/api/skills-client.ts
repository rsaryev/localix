import { client, unwrap } from './internal'
import { toUiSession } from './converters'
import type { CuratorReport, UiSession } from './contracts'

/**
 * Skills: the curator's sweep (called with plain fetch because the generated hono client doesn't
 * merge the `/rpc/skills/curator` mount) and per-session skill pinning. A skill is written,
 * edited, archived and removed through the Store; its list rides in the capability snapshot as
 * summaries. Spread into `backendClient`.
 */
export const skillsApi = {
  async runSkillsCurator(opts?: { projectId?: string | null }): Promise<CuratorReport> {
    return unwrap(
      await client.rpc.skills.curator.run.$post({ json: { projectId: opts?.projectId ?? null } }),
    )
  },

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
