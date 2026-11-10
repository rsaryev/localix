import type { SkillEntry, SkillToolPorts } from '../tools/skill-call'

/** A skill a test hands the `Skill` tool: found by the name it is called by, its text as written. */
export type TestSkill = Omit<SkillEntry, 'ownName' | 'scope'> &
  Partial<Pick<SkillEntry, 'ownName' | 'scope'>>

/**
 * The host's `findSkill` over a fixed list, for the tool's own behaviour (its answers, its bound,
 * its telemetry); how a chat finds and runs skills is the kit session's (`skill-tool-ports.ts`).
 */
export function testSkillPorts(
  skills: readonly TestSkill[],
  more: SkillToolPorts = {},
): SkillToolPorts {
  // Its own properties as they are: a `content` getter is read when the `get` returns it.
  const entries = skills.map(
    (skill): SkillEntry =>
      Object.defineProperties(
        { ownName: skill.name, scope: 'project' },
        Object.getOwnPropertyDescriptors(skill),
      ) as SkillEntry,
  )
  return {
    findSkill: async (name) => {
      const skill = entries.find((one) => one.name === name)
      return { ...(skill ? { skill } : {}), names: entries.map((one) => one.name) }
    },
    ...more,
  }
}
