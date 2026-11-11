import type { SessionSkill } from '@rsaryev/llx-plugin'
import type { CommandListing } from '@rsaryev/llx-plugin/mods'
import { skillPlugin } from '../features/plugins/kit'

/**
 * What `$.command.list()` lists beside the mods' own commands: Localix's built-in slash commands
 * (`builtin`), the skills a person runs by name — their own and the project's (`user`) and the
 * enabled plugins' (`plugin`, named `<plugin>:<skill>` as the kit names them) — in the order the
 * typeahead lists them. The skills are the kit's rows of the scope (`scopeSkills`).
 */
export function localixCommands(input: {
  builtins: readonly { name: string; description: string; hidden?: boolean }[]
  skills: readonly SessionSkill[]
}): CommandListing[] {
  const seen = new Set<string>()
  const listed: CommandListing[] = []
  const add = (command: CommandListing) => {
    if (seen.has(command.name)) return
    seen.add(command.name)
    listed.push(command)
  }
  for (const command of input.builtins)
    if (!command.hidden)
      add({ name: command.name, description: command.description, source: 'builtin' })
  for (const skill of input.skills) {
    const { command: name } = skill.invocable
    const description = skill.invocable.description ?? ''
    const plugin = skillPlugin(skill)
    add(
      plugin
        ? { name, description, source: 'plugin', plugin: plugin.name }
        : { name, description, source: 'user' },
    )
  }
  return listed
}
