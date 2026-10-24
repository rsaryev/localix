import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { filterDisabledSkills, type SkillOverrides } from '../../agent-core/skill-overrides'
import { skillCallName } from '../../agent-core/tools/skill-names'

// Sits beside `prompt-skills.ts` (the model-selectable roster) and `prompt-skill-triggers.ts`
// (keyword-forced skills): the third way a skill reaches a prompt, and the only explicit one.

/**
 * Resolve explicitly pinned skills in the order they were configured.
 *
 * A pin is an explicit invocation, so `disable-model-invocation` must not hide
 * it: that flag only removes a skill from the model-selectable roster. This is
 * the same split other agents make for `/skill:name` and Codex makes for an explicit
 * `$skill` mention when implicit invocation is disabled.
 */
/** Claude Code preloads "up to the first 32 distinct names" an agent file's `skills` lists. */
const MAX_PRELOADED_SKILLS = 32

export function resolvePinnedSkills(
  allSkills: readonly DiscoveredSkill[],
  pinnedNames: readonly string[],
  skillOverrides: SkillOverrides = {},
  /**
   * `preload`: the names are an agent file's `skills`, not the person's pins. Claude Code
   * preloads from the skills Claude may invoke, so a `disable-model-invocation` skill is left out,
   * and only the first 32 distinct names count.
   */
  opts: { preload?: boolean } = {},
): Array<{ name: string; content: string }> {
  const byName = new Map<string, DiscoveredSkill>()
  for (const skill of filterDisabledSkills(allSkills, skillOverrides)) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill)
    // A plugin's skill by the name it is called by (`kit:lookup`), as an agent file names it.
    const called = skillCallName(skill)
    if (!byName.has(called)) byName.set(called, skill)
  }
  const distinct = [...new Set(pinnedNames)]
  const names = opts.preload ? distinct.slice(0, MAX_PRELOADED_SKILLS) : distinct
  const seen = new Set<string>()
  return names.flatMap((name) => {
    if (seen.has(name)) return []
    seen.add(name)
    const skill = byName.get(name)
    if (!skill || (opts.preload && skill.disableModelInvocation)) return []
    try {
      return [
        {
          name: skillCallName(skill),
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
