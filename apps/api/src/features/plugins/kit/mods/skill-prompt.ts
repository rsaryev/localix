import { readFile } from 'node:fs/promises'
import { parseFrontmatter } from '@rsaryev/llx-plugin/format'
import { skillPromptEvent, type SkillPromptEvent } from '@rsaryev/llx-plugin/mods'

/** Where a skill Localix expands comes from: its file, whose skill it is, and its plugin. */
export interface SkillOrigin {
  path?: string
  scope: 'project' | 'global'
  pluginName?: string
}

export type SkillPromptInput = SkillPromptEvent

/** Claude Code's `source` word for a skill: a plugin's, the person's, the project's. */
const sourceOf = (origin: SkillOrigin) =>
  origin.pluginName ? 'plugin' : origin.scope === 'global' ? 'userSettings' : 'projectSettings'

/**
 * The `skill.prompt` event for the skill `name` whose text is `text`, by the kit: its frontmatter
 * read from its file as the kit parses it (with the reason when the block does not parse), and a
 * skill with no origin as `built-in`, with no file and no frontmatter.
 */
export async function skillPromptInput(
  name: string,
  text: string,
  origin?: SkillOrigin,
): Promise<SkillPromptInput> {
  if (!origin) return skillPromptEvent({ name, source: 'built-in' }, text)
  const file = origin.path ? await readFile(origin.path, 'utf8').catch(() => undefined) : undefined
  return skillPromptEvent(
    {
      name,
      source: sourceOf(origin),
      ...(origin.pluginName ? { pluginName: origin.pluginName } : {}),
      ...(origin.path ? { path: origin.path } : {}),
      ...(file === undefined ? {} : { frontmatter: parseFrontmatter(file) }),
    },
    text,
  )
}
