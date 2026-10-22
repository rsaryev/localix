import { basename } from 'node:path'
import type { DiscoveredSkill } from '../skill-frontmatter'

/**
 * The name a skill is called by: a plugin's skill as Claude Code names it, `<plugin>:<name>`
 * (a `name` that already carries the prefix is not prefixed again), anything else by its name.
 */
export function skillCallName(skill: DiscoveredSkill): string {
  if (!skill.pluginName) return skill.name
  const prefix = `${skill.pluginName}:`
  return skill.name.toLowerCase().startsWith(prefix.toLowerCase())
    ? skill.name
    : `${prefix}${skill.name}`
}

/**
 * The skill a name asks for. Its own name first, then a plugin skill's `<plugin>:<name>`, then
 * `<plugin>:<folder>`: a plugin's command may name its skill by folder (hookify's
 * `hookify:writing-rules` is the folder of the skill whose `name` is `writing-hookify-rules`).
 */
export function findSkillByName(
  skills: readonly DiscoveredSkill[],
  name: string,
): DiscoveredSkill | undefined {
  const asked = name.trim().replace(/^\//, '').toLowerCase()
  return (
    skills.find((skill) => skill.name.toLowerCase() === asked) ??
    skills.find((skill) => skillCallName(skill).toLowerCase() === asked) ??
    skills.find(
      (skill) =>
        skill.pluginName !== undefined &&
        `${skill.pluginName}:${basename(skill.dir)}`.toLowerCase() === asked,
    )
  )
}
