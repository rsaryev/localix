import type { DiscoveredSkill } from '../features/agent-core/skill-frontmatter'
import type { ModCommandInfo } from '../features/mods/contracts'

/**
 * What `$.command.list()` lists beside the mods' own commands: Localix's built-in slash commands
 * (`builtin`), the skills a person runs by name — their own and the project's (`user`) and the
 * enabled plugins' (`plugin`, named `<plugin>:<skill>` as they are typed) — in the order the
 * typeahead lists them.
 */
export function localixCommands(input: {
  builtins: readonly { name: string; description: string; hidden?: boolean }[]
  skills: readonly Pick<DiscoveredSkill, 'name' | 'description' | 'pluginName'>[]
}): ModCommandInfo[] {
  const seen = new Set<string>()
  const listed: ModCommandInfo[] = []
  const add = (command: ModCommandInfo) => {
    if (seen.has(command.name)) return
    seen.add(command.name)
    listed.push(command)
  }
  for (const command of input.builtins)
    if (!command.hidden)
      add({ name: command.name, description: command.description, source: 'builtin' })
  for (const skill of input.skills)
    add(
      skill.pluginName
        ? {
            name: skill.name.includes(':') ? skill.name : `${skill.pluginName}:${skill.name}`,
            description: skill.description,
            source: 'plugin',
            plugin: skill.pluginName,
          }
        : { name: skill.name, description: skill.description, source: 'user' },
    )
  return listed
}
