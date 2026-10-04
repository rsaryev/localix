import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { filterDisabledSkills, type SkillOverrides } from '../../agent-core/skill-overrides'

// Sits beside `prompt-skills.ts` (the model-selectable roster) and `prompt-skill-triggers.ts`
// (keyword-forced skills): the third way a skill reaches a prompt, and the only explicit one.

/**
 * Resolve explicitly pinned skills in the order they were configured.
 *
 * A pin is an explicit invocation, so `disable-model-invocation` must not hide
 * it: that flag only removes a skill from the model-selectable roster. This is
 * the same split Pi makes for `/skill:name` and Codex makes for an explicit
 * `$skill` mention when implicit invocation is disabled.
 */
export function resolvePinnedSkills(
  allSkills: readonly DiscoveredSkill[],
  pinnedNames: readonly string[],
  skillOverrides: SkillOverrides = {},
): Array<{ name: string; content: string }> {
  const byName = new Map(
    filterDisabledSkills(allSkills, skillOverrides).map((skill) => [skill.name, skill]),
  )
  const seen = new Set<string>()
  return pinnedNames.flatMap((name) => {
    if (seen.has(name)) return []
    seen.add(name)
    const skill = byName.get(name)
    if (!skill) return []
    try {
      return [
        {
          name: skill.name,
          content: [
            `Resolve relative references from: ${JSON.stringify(skill.dir)}`,
            '',
            skill.content,
          ].join('\n'),
        },
      ]
    } catch {
      // A deleted/replaced lazy skill must not abort the whole agent run. The
      // explicit skill.get and slash-command paths surface a diagnostic; a stale
      // session pin degrades by omission until discovery sees a valid file again.
      return []
    }
  })
}
