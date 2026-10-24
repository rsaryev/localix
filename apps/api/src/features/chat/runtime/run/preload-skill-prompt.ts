import type { ModRunScope } from '../../../mods/run-scope'

/**
 * Preloaded and pinned skills through the mods' `skill.prompt`, as Claude Code fires it for a skill
 * "preloaded into a subagent": each body is the text a mod may rewrite before the prompt holds it.
 */
export async function preloadedSkillsThroughMods<T extends { name: string; content: string }>(
  skills: readonly T[],
  mods: Pick<ModRunScope, 'skillPrompt'>,
): Promise<T[]> {
  if (!mods.skillPrompt || skills.length === 0) return [...skills]
  return Promise.all(
    skills.map(async (skill) => ({
      ...skill,
      content: (await mods.skillPrompt!(skill.name, skill.content)) ?? skill.content,
    })),
  )
}
