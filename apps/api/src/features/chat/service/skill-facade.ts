import type { SessionDetail } from '../contracts'
import type { SessionRecord } from '../repository'
import { filterDisabledSkills } from '../../agent-core/skill-overrides'
import type { createAuxProviderHelpers } from './aux-provider'
import type { createChatRepository } from '../repository'
import type { createSessionWorkspace } from './session-workspace'
import * as skillOps from './skill-ops'
import { capabilitiesChanged } from '../../capabilities/revision'
import type { SkillInput, SkillRecord } from './skills'
import type { SkillOverrides } from '../../agent-core/skill-overrides'

/**
 * Skills — the files a session reads as instructions, and the set it has pinned.
 *
 * A skill is a `SKILL.md` on disk, not a row, which is the whole reason this group exists apart:
 * every read here resolves a project's directory before the user's, so a project can override a
 * personal skill by name, and every write is a file write whose effect the session has to be told
 * about. `setSessionSkills` is the one that shows it — it persists the pin AND republishes the
 * session, because a warmed prompt that nobody was told about is the same as no pin at all.
 */
export interface ChatSkillFacadeDeps {
  skillOpsCtx: skillOps.SkillOpsContext
  requireSession: (userId: string, id: string) => Promise<SessionRecord>
  getSessionDetail: (userId: string, id: string) => Promise<SessionDetail>
  publishSession: (session: SessionRecord) => void
  gatherSessionSkills: ReturnType<typeof createSessionWorkspace>['gatherSessionSkills']
  repo: ReturnType<typeof createChatRepository>
  now: () => string
  readAgentSettings: ReturnType<typeof createAuxProviderHelpers>['readAgentSettings']
  /** Skill visibility for a scope — the same resolver the run pipeline asks. */
  loadSkillOverrides: (
    userId: string,
    projectId: string | null,
    names: readonly string[],
  ) => Promise<SkillOverrides>
}

export function createChatSkillFacade({
  skillOpsCtx,
  requireSession,
  getSessionDetail,
  publishSession,
  gatherSessionSkills,
  loadSkillOverrides,
  repo,
  now,
}: ChatSkillFacadeDeps) {
  return {
    /**
     * Lists skills as SKILL.md files. With `projectId` it resolves that project's
     * working dir and walks up the tree (plus global home); without one, only
     * global skills. Skills are never stored in the DB.
     */
    async getSkill(userId: string, name: string, opts?: { projectId?: string | null }) {
      return skillOps.getSkill(skillOpsCtx, userId, name, opts)
    },

    async listSkills(userId: string, opts?: { projectId?: string | null }) {
      return skillOps.listSkills(skillOpsCtx, userId, opts)
    },

    /**
     * Pins/unpins skills on a session — "applying" a skill warms it into the
     * system prompt for the whole session without running the agent. Names not
     * matching an available skill are dropped. Returns the updated session.
     */
    async setSessionSkills(
      userId: string,
      sessionId: string,
      names: string[],
    ): Promise<SessionDetail> {
      const session = await requireSession(userId, sessionId)
      const skills = await gatherSessionSkills(userId, session)
      const skillOverrides = await loadSkillOverrides(
        userId,
        session.projectId,
        skills.map((skill) => skill.name),
      )
      const available = new Set(
        filterDisabledSkills(skills, skillOverrides).map((skill) => skill.name),
      )
      const pinned = [...new Set(names)].filter((n) => available.has(n))
      const updated: SessionRecord = {
        ...session,
        pinnedSkills: pinned,
        updatedAt: now(),
      }
      await repo.updateSession(userId, sessionId, updated)
      publishSession(updated)
      return getSessionDetail(userId, sessionId)
    },

    /** Creates/overwrites a SKILL.md file (project working dir, or home for global). */
    async createSkill(userId: string, input: SkillInput): Promise<SkillRecord> {
      const record = await skillOps.createSkill(skillOpsCtx, userId, input)
      capabilitiesChanged()
      return record
    },

    async updateSkill(userId: string, _id: string, input: Partial<SkillInput>) {
      const record = await skillOps.updateSkill(skillOpsCtx, userId, _id, input)
      capabilitiesChanged()
      return record
    },

    /** Deletes a skill by name, scoped to the given project (or global). */
    async deleteSkill(userId: string, id: string, projectId?: string | null) {
      const result = await skillOps.deleteSkill(skillOpsCtx, userId, id, projectId)
      capabilitiesChanged()
      return result
    },
  }
}
