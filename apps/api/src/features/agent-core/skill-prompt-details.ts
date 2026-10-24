import { parseYamlFrontmatterBlock } from './frontmatter-yaml'
import { readSkillMarkdownFile } from './skill-file'

/** A skill as a `skill.prompt` hook is told about it (Claude Code's `SkillPromptInput`). */
export interface SkillPromptDetails {
  frontmatter: Record<string, unknown>
  source: string
  pluginName?: string
  path?: string
}

/**
 * What a `skill.prompt` hook is handed about a skill beside its text, in Claude Code's words: its
 * frontmatter as the file declares it, whose words it is (`plugin`, `userSettings`,
 * `projectSettings`, or `built-in` with no file), its plugin and the file's path.
 */
export async function skillPromptDetails(skill: {
  path?: string
  scope: 'project' | 'global'
  pluginName?: string
}): Promise<SkillPromptDetails> {
  const raw = skill.path ? await readSkillMarkdownFile(skill.path).catch(() => '') : ''
  const frontmatter = (raw && parseYamlFrontmatterBlock(raw)) || {}
  return {
    frontmatter,
    source: skill.pluginName
      ? 'plugin'
      : skill.scope === 'global'
        ? 'userSettings'
        : 'projectSettings',
    ...(skill.pluginName ? { pluginName: skill.pluginName } : {}),
    ...(skill.path ? { path: skill.path } : {}),
  }
}
