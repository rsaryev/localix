import type { ChatSkill } from '../../../plugins/kit'

/**
 * A SessionStart hook's `reloadSkills` (hooks.md, "Reload skills that a hook installs"): the run
 * reads the skills after its hooks ran, so a skill a hook wrote is in this run's session. When the
 * prompt's listing was frozen earlier in the view epoch, the agent is told of the skills it lacks;
 * the Skill tool finds them either way.
 */
export function reloadedSkillsNote(
  skills: readonly ChatSkill[],
  frozenListing: string | undefined,
): string | undefined {
  const listed = new Set(
    (frozenListing ?? '').split('\n').map((line) => line.replace(/^- /, '').split(':')[0]),
  )
  const added = skills.filter(
    (skill) => skill.modelInvocable && !skill.dormant && !listed.has(skill.name),
  )
  if (!added.length) return undefined
  return [
    'Skills a SessionStart hook installed, available with the Skill tool:',
    ...added.map((skill) => `- ${skill.name}: ${skill.description}`),
  ].join('\n')
}
