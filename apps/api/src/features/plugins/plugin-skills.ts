import { scalarConfig } from '../capabilities/source-repository'
import {
  readSkillsFromRoot,
  type DiscoveredSkill,
  type SkillDiscoveryLogger,
} from '../agent-core/skill-discovery'
import { errorMessage } from '../../lib/errors'
import type { PluginCatalog } from './catalog'
import { listCommandsFromCatalog, modCommandSpecs } from './commands'
import { resolvePluginConfig } from './config'
import type { PluginCommandSpec } from './contracts'
import { pluginLoadBlockReason } from './load-block'
import { makePluginSubstituter } from './loader-runtime-declarations'

/**
 * A plugin's `SKILL.md` skill as the person types it: `/<plugin>:<skill>`.
 *
 * Claude Code names a plugin skill `<plugin>:<name>`, where `<name>` is the frontmatter `name` or
 * the skill's folder, and a `name` that already carries the plugin's own prefix is not prefixed
 * again (https://code.claude.com/docs/en/skills#how-a-skill-gets-its-command-name).
 */
export interface PluginSkill {
  pluginName: string
  pluginDir: string
  /** `<plugin>:<skill>` — the command typed after `/`. */
  fullName: string
  /** The skill's own last segment, also typed bare when no other command takes it. */
  shortName: string
  /** Read like the loader reads it for the model: path variables and options substituted. */
  skill: DiscoveredSkill
}

/** `<plugin>:<skill>`, without doubling a prefix the frontmatter `name` already carries. */
export function pluginSkillFullName(pluginName: string, skillName: string): string {
  const prefix = `${pluginName}:`
  return skillName.toLowerCase().startsWith(prefix.toLowerCase())
    ? skillName
    : `${prefix}${skillName}`
}

/**
 * The skills of every ENABLED plugin in the catalog, read exactly as `loadEnabledPlugins` reads
 * them for the model — the same block rule, the same substituter — so `/<plugin>:<skill>` runs the
 * text the model would have loaded. Bodies stay lazy: only the skill that runs is read in full.
 */
export async function readCatalogPluginSkills(
  catalog: PluginCatalog,
  opts: { projectId: string; projectDir: string; homeDir: string; logger?: SkillDiscoveryLogger },
): Promise<PluginSkill[]> {
  const perPlugin = await Promise.all(
    catalog.enabled.map(async ({ plugin, state }) => {
      if (!opts.projectId && plugin.scope === 'project') return []
      if (pluginLoadBlockReason(plugin)) return []
      const name = plugin.manifest.name
      const config = resolvePluginConfig(plugin.manifest, scalarConfig(state?.config))
      const subst = makePluginSubstituter(
        plugin.dir,
        name,
        config,
        plugin.manifest,
        opts.projectDir,
        opts.homeDir,
      )
      const scope = plugin.scope === 'project' ? 'project' : 'global'
      const out: PluginSkill[] = []
      for (const skillDir of plugin.entrypoints.skillDirs) {
        // The loader reports an unreadable skills folder on the plugin's row; here it only
        // means the folder offers no commands.
        const skills = await readSkillsFromRoot(skillDir, scope, opts.logger, subst).catch(
          (err: unknown) => {
            opts.logger?.warn(`plugin "${name}" failed to read skills from ${skillDir}`, {
              error: errorMessage(err),
            })
            return []
          },
        )
        for (const skill of skills) {
          if (skill.description) skill.description = subst(skill.description)
          // Claude Code substitutes the plugin's path variables in `allowed-tools` too, so a
          // skill can pre-approve its own bundled script.
          if (skill.allowedTools) skill.allowedTools = skill.allowedTools.map(subst)
          skill.pluginName = name
          const fullName = pluginSkillFullName(name, skill.name)
          out.push({
            pluginName: name,
            pluginDir: plugin.dir,
            fullName,
            shortName: fullName.slice(name.length + 1),
            skill,
          })
        }
      }
      return out
    }),
  )
  return perPlugin.flat()
}

/**
 * Plugin skills as composer commands. A model-only skill (`user-invocable: false`) is not offered,
 * and a `taken` command of the same full name keeps its entry.
 */
export function pluginSkillCommandSpecs(
  skills: readonly PluginSkill[],
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
  for (const { pluginName, fullName, shortName, skill } of skills) {
    if (skill.userInvocable === false || seen.has(fullName.toLowerCase())) continue
    seen.add(fullName.toLowerCase())
    specs.push({
      pluginName,
      name: shortName,
      fullName,
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
    logger?: SkillDiscoveryLogger
  },
): Promise<PluginCommandSpec[]> {
  const mods = modCommandSpecs(catalog, opts.modCommands)
  const skills = pluginSkillCommandSpecs(await readCatalogPluginSkills(catalog, opts), mods)
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
  return [...commands, ...mods, ...skills]
}
