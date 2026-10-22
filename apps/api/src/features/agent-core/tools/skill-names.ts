import { basename } from 'node:path'
import type { DiscoveredSkill } from '../skill-frontmatter'

/**
 * The name a skill is called by: a plugin's skill as Claude Code names it, `<plugin>:<name>`
 * (a `name` that already carries the prefix is not prefixed again), anything else by its name.
 */
export function skillCallName(skill: Pick<DiscoveredSkill, 'name' | 'pluginName'>): string {
  if (!skill.pluginName) return skill.name
  const prefix = `${skill.pluginName}:`
  return skill.name.toLowerCase().startsWith(prefix.toLowerCase())
    ? skill.name
    : `${prefix}${skill.name}`
}

const askedName = (name: string) => name.trim().replace(/^\//, '').toLowerCase()

/** The plugin skills a bare name could mean: more than one is ambiguous, and none is chosen. */
function byBareName(skills: readonly DiscoveredSkill[], asked: string): DiscoveredSkill[] {
  return skills.filter((skill) => skill.pluginName && skill.name.toLowerCase() === asked)
}

/**
 * The skill a name asks for. The name it is called by first (a project or personal skill's is
 * its bare name, so `lookup` is that skill even when a plugin also has a `lookup`), then a plugin
 * skill's bare name when exactly one plugin skill has it, then `<plugin>:<folder>`: a plugin's
 * command may name its skill by folder (hookify's `hookify:writing-rules` is the folder of the
 * skill whose `name` is `writing-hookify-rules`). Neither order nor sorting picks between two
 * skills: a bare name two plugins share finds nothing (see {@link ambiguousSkillNames}).
 */
export function findSkillByName(
  skills: readonly DiscoveredSkill[],
  name: string,
): DiscoveredSkill | undefined {
  const asked = askedName(name)
  const exact = skills.find((skill) => skillCallName(skill).toLowerCase() === asked)
  if (exact) return exact
  const bare = byBareName(skills, asked)
  if (bare.length > 0) return bare.length === 1 ? bare[0] : undefined
  return skills.find(
    (skill) =>
      skill.pluginName !== undefined &&
      `${skill.pluginName}:${basename(skill.dir)}`.toLowerCase() === asked,
  )
}

/** The call names a bare name could mean when more than one plugin skill has it; else empty. */
export function ambiguousSkillNames(skills: readonly DiscoveredSkill[], name: string): string[] {
  const asked = askedName(name)
  if (skills.some((skill) => skillCallName(skill).toLowerCase() === asked)) return []
  const bare = byBareName(skills, asked)
  return bare.length > 1 ? bare.map(skillCallName) : []
}
