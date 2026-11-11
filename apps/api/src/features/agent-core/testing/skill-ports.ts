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

/**
 * The host's `save` as a record of what the tool hands over: each draft and its scope, answered
 * with the `SKILL.md` a host would write under `root` (`<root>/<scope>/skills/<name>/SKILL.md`).
 * Writing the file is the host's (`chat/skill-files.ts`).
 */
export function testSavePorts(root: string): Required<
  Pick<SkillToolPorts, 'saveSkill' | 'skillFilePath'>
> & {
  readonly saved: Array<{ name: string; description: string; content: string; scope: string }>
} {
  const saved: Array<{ name: string; description: string; content: string; scope: string }> = []
  const skillFilePath = (name: string, scope: string) => `${root}/${scope}/skills/${name}/SKILL.md`
  return {
    saved,
    skillFilePath,
    saveSkill: async (draft, scope) => {
      saved.push({ ...draft, scope })
      return skillFilePath(draft.name, scope)
    },
  }
}
