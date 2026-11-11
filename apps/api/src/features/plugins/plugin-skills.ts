import { listFolderWorkflows } from './folder-workflows'
import { scalarConfig } from '../capabilities/source-repository'
import { dataDirOfPlugin, pluginIdOf } from './plugin-data-id'
import type { PluginCatalog } from './catalog'
import { listCommandsFromCatalog, modCommandSpecs } from './commands'
import { resolvePluginConfig } from './config'
import type { PluginCommand, PluginCommandSpec } from './contracts'
import { makePluginSubstituter } from './loader-runtime-declarations'
import { kitPluginsOf } from './catalog-kit'
import { scopeSkills, type ChatSkill, type LocalixPluginHost } from './kit'

/** A plugin's skill or command as the kit lists it: what the composer shows of it. */
export type PluginSkillRow = Pick<
  ChatSkill,
  'name' | 'description' | 'argumentHint' | 'inMenu' | 'plugin'
>

/**
 * The commands of every ENABLED plugin, with their text read as a skill's is (a command is a skill
 * in Claude Code): `${user_config.KEY}` takes the saved value, a sensitive one a placeholder.
 */
export function catalogPluginCommands(
  catalog: PluginCatalog,
  opts: { projectDir: string; homeDir: string },
): Array<{ plugin: string; command: PluginCommand; pluginDir: string; dataDir: string }> {
  return catalog.enabled.flatMap(({ plugin, state }) => {
    const name = plugin.manifest.name
    const config = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
    const subst = makePluginSubstituter(
      plugin.dir,
      pluginIdOf(plugin),
      config,
      plugin.manifest,
      opts.projectDir,
      opts.homeDir,
    )
    return plugin.commands.map((command) => ({
      plugin: name,
      command: { ...command, prompt: subst(command.prompt) },
      pluginDir: plugin.dir,
      dataDir: dataDirOfPlugin(plugin, opts.homeDir),
    }))
  })
}

/**
 * Plugin skills as composer commands, named as the kit names them (`<plugin>:<skill>`). One the
 * `/` menu does not offer (`user-invocable: false`) is not listed, and a `taken` command of the same
 * full name keeps its entry.
 */
export function pluginSkillCommandSpecs(
  skills: readonly PluginSkillRow[],
  taken: readonly PluginCommandSpec[],
): PluginCommandSpec[] {
  // A command named after its plugin is listed bare (`/feature-dev`) yet also answers
  // `/feature-dev:feature-dev`, which dispatch tries before skills.
  const seen = new Set(
    taken.flatMap((spec) => [
      spec.fullName.toLowerCase(),
      ...(spec.fullName === spec.pluginName
        ? [`${spec.pluginName}:${spec.name}`.toLowerCase()]
        : []),
    ]),
  )
  const specs: PluginCommandSpec[] = []
  for (const skill of skills) {
    const plugin = skill.plugin?.name
    if (!plugin || !skill.inMenu || seen.has(skill.name.toLowerCase())) continue
    seen.add(skill.name.toLowerCase())
    specs.push({
      pluginName: plugin,
      name: skill.name.startsWith(`${plugin}:`) ? skill.name.slice(plugin.length + 1) : skill.name,
      fullName: skill.name,
      description: skill.description,
      args: [],
      ...(skill.argumentHint ? { argumentHint: skill.argumentHint } : {}),
    })
  }
  return specs
}

/**
 * Every composer command of a scope: plugin commands, mods' commands, then plugin skills. One
 * function so the capability snapshot and the commands route cannot list different things. A
 * plugin skill and a plugin command of the same name list once, as the skill: the skill is what
 * runs (Claude Code, "Resolve skills that share a name").
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
  // A command named after its plugin also answers `/<plugin>:<plugin>`, which a skill may take.
  const commands = listCommandsFromCatalog(catalog, opts.projectId).filter(
    (spec) =>
      !bySkill.has(spec.fullName.toLowerCase()) &&
      !(
        spec.fullName === spec.pluginName &&
        bySkill.has(`${spec.pluginName}:${spec.name}`.toLowerCase())
      ),
  )
  const saved: PluginCommandSpec[] = (
    await listFolderWorkflows({ cwd: opts.projectDir, homeDir: opts.homeDir })
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
