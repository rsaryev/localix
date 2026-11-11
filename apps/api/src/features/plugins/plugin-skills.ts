import type { PluginCatalog } from './catalog'
import { listCommandsFromCatalog, modCommandSpecs } from './commands'
import type { PluginCommandSpec } from './contracts'
import { kitPluginsOf } from './catalog-kit'
import type { SessionSkill } from '@rsaryev/llx-plugin'
import { savedWorkflows, scopeSkills, skillPlugin, type LocalixPluginHost } from './kit'

/**
 * Plugin skills as composer commands, named as the kit names them (`<plugin>:<skill>`). One the
 * `/` menu does not offer (`user-invocable: false`) is not listed, and a `taken` command of the same
 * full name keeps its entry.
 */
export function pluginSkillCommandSpecs(
  skills: readonly SessionSkill[],
  taken: readonly PluginCommandSpec[],
): PluginCommandSpec[] {
  const seen = new Set(taken.map((spec) => spec.fullName.toLowerCase()))
  const specs: PluginCommandSpec[] = []
  for (const skill of skills) {
    const plugin = skillPlugin(skill)?.name
    const { command, description, argumentHint } = skill.invocable
    if (!plugin || !skill.policy.inMenu || seen.has(command.toLowerCase())) continue
    seen.add(command.toLowerCase())
    specs.push({
      pluginName: plugin,
      name: command.startsWith(`${plugin}:`) ? command.slice(plugin.length + 1) : command,
      fullName: command,
      description: description ?? '',
      args: [],
      ...(argumentHint ? { argumentHint } : {}),
    })
  }
  return specs
}

/**
 * Every composer command of a scope: plugin workflows, mods' commands, saved workflows, then the
 * plugin skills and commands the kit lists. One function so the capability snapshot and the
 * commands route cannot list different things. A name lists once, as what it runs: a plugin's
 * command over its skill of the name (Claude Code 2.1.319), a skill over a workflow.
 */
export async function listCatalogCommandSpecs(
  catalog: PluginCatalog,
  opts: {
    projectId: string
    projectDir: string
    homeDir: string
    modCommands: Parameters<typeof modCommandSpecs>[1]
    /**
     * The kit host the scope's plugin skills and commands are listed through (`scopeSkills`, the
     * catalog's plugins); without one, no plugin skill is listed.
     */
    pluginHost?: LocalixPluginHost
  },
): Promise<PluginCommandSpec[]> {
  const mods = modCommandSpecs(catalog, opts.modCommands)
  const skills = pluginSkillCommandSpecs(
    opts.pluginHost
      ? (
          await scopeSkills(opts.pluginHost, {
            cwd: opts.projectDir,
            homeDir: opts.homeDir,
            plugins: kitPluginsOf(catalog),
          })
        ).skills
      : [],
    mods,
  )
  const bySkill = new Set(skills.map((spec) => spec.fullName.toLowerCase()))
  // The kit lists a plugin's commands with its skills; what is left are its workflows.
  const commands = listCommandsFromCatalog(catalog, opts.projectId).filter(
    (spec) => !bySkill.has(spec.fullName.toLowerCase()),
  )
  const saved: PluginCommandSpec[] = (
    await savedWorkflows({ cwd: opts.projectDir, homeDir: opts.homeDir })
  )
    .filter((entry) => !bySkill.has(entry.fullName.toLowerCase()))
    .map((entry) => ({
      pluginName: entry.fullName,
      name: entry.fullName,
      fullName: entry.fullName,
      description: entry.description,
      args: [],
      argumentHint: '[input]',
    }))
  return [...commands, ...mods, ...saved, ...skills]
}
