import { realpath } from 'node:fs/promises'
import { readCommandFileAsSkill } from '../agent-core/skill-scan-commands'
import type { DiscoveredSkill, SkillDiscoveryLogger } from '../agent-core/skill-discovery'
import type { DiscoveredPlugin } from './discovery-types'

const quiet: SkillDiscoveryLogger = { warn: () => {} }

/**
 * A plugin's `commands/*.md` files read as skills too. In Claude Code a command file "supports the
 * same frontmatter" as a skill and Claude invokes it through the Skill tool unless
 * `disable-model-invocation` is set; read as a skill, it reaches the model's roster and runs
 * through the skill path (fork, agent type, effort, hooks, `user-invocable`). Its slash dispatch
 * steps aside for a skill of the same name (`command-handlers-plugin-command.ts`). A name a
 * `skills/` entry already has is left to that skill, as Claude Code prefers the skill.
 */
export async function readPluginCommandSkills(
  plugin: Pick<DiscoveredPlugin, 'dir' | 'entrypoints'>,
  scope: 'project' | 'global',
  taken: ReadonlySet<string>,
  subst: (text: string) => string,
  logger: SkillDiscoveryLogger = quiet,
): Promise<DiscoveredSkill[]> {
  const files = plugin.entrypoints.commandFiles ?? []
  if (files.length === 0) return []
  const safetyRoot = await realpath(plugin.dir).catch(() => null)
  if (!safetyRoot) return []
  const out: DiscoveredSkill[] = []
  for (const { file, name } of files) {
    if (taken.has(name)) continue
    const skill = await readCommandFileAsSkill(file, name, scope, logger, safetyRoot, subst)
    if (skill) out.push(skill)
  }
  return out
}
