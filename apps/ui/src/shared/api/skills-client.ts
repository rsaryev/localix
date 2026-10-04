import { client, unwrap, cleanQuery, apiFetch, API_BASE_URL, assertOk } from './internal'
import { toUiSession } from './converters'
import type {
  SkillRecord,
  SkillInput,
  CuratorSkillRecord,
  CuratorReport,
  SessionDetail,
  UiSession,
} from './contracts'

/**
 * Skills: SKILL.md CRUD, the curator (archive/restore/pin/run — called with
 * plain fetch because the generated hono client doesn't merge the
 * `/rpc/skills/curator` mount), and per-session skill pinning. The skill LIST is not
 * here: it rides in the capability snapshot as summaries, and a body is read one skill
 * at a time by `getSkill`. Spread into
 * `backendClient`.
 */
export const skillsApi = {
  /**
   * ONE skill, body included — what the editor opens.
   *
   * The LIST is a catalog and rides in the capability snapshot as summaries: a skill
   * body is arbitrary markdown, and a catalog that carries every body grows with the
   * user's writing. Bodies are read one at a time, when one is actually needed.
   */
  async getSkill(name: string, opts?: { projectId?: string | null }): Promise<SkillRecord> {
    return unwrap<SkillRecord>(
      await client.rpc.skills[':name'].$get({
        param: { name },
        query: cleanQuery({ projectId: opts?.projectId }),
      }),
    )
  },

  async createSkill(input: SkillInput): Promise<SkillRecord> {
    return unwrap<SkillRecord>(await client.rpc.skills.$post({ json: input }))
  },

  async listCuratorSkills(opts?: { projectId?: string | null }): Promise<CuratorSkillRecord[]> {
    const query = opts?.projectId ? `?projectId=${encodeURIComponent(opts.projectId)}` : ''
    const json = await unwrap<{ skills: CuratorSkillRecord[] }>(
      await apiFetch(`${API_BASE_URL}/rpc/skills/curator${query}`),
    )
    return json.skills
  },

  async setSkillPinned(
    name: string,
    scope: 'global' | 'project',
    pinned: boolean,
    opts?: { projectId?: string | null },
  ): Promise<CuratorSkillRecord> {
    return unwrap<CuratorSkillRecord>(
      await apiFetch(`${API_BASE_URL}/rpc/skills/curator/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, scope, pinned, projectId: opts?.projectId ?? null }),
      }),
    )
  },

  async archiveSkill(
    name: string,
    opts?: { projectId?: string | null },
  ): Promise<CuratorSkillRecord> {
    return unwrap<CuratorSkillRecord>(
      await apiFetch(`${API_BASE_URL}/rpc/skills/curator/archive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, projectId: opts?.projectId ?? null }),
      }),
    )
  },

  async restoreSkill(
    name: string,
    opts?: { projectId?: string | null },
  ): Promise<CuratorSkillRecord> {
    return unwrap<CuratorSkillRecord>(
      await apiFetch(`${API_BASE_URL}/rpc/skills/curator/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, projectId: opts?.projectId ?? null }),
      }),
    )
  },

  async runSkillsCurator(opts?: { projectId?: string | null }): Promise<CuratorReport> {
    return unwrap<CuratorReport>(
      await apiFetch(`${API_BASE_URL}/rpc/skills/curator/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: opts?.projectId ?? null }),
      }),
    )
  },

  async setSessionSkills(sessionId: string, names: string[]): Promise<UiSession> {
    const json = await unwrap<SessionDetail>(
      await client.rpc.sessions[':id'].skills.$post({
        param: { id: sessionId },
        json: { skills: names },
      }),
    )
    return toUiSession(json)
  },

  async deleteSkill(name: string, projectId?: string | null): Promise<void> {
    const response = await client.rpc.skills[':name'].$delete({
      param: { name },
      query: cleanQuery({ projectId }),
    })
    await assertOk(response)
  },
}
