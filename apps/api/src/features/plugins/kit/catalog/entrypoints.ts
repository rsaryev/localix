import { realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Plugin } from '@rsaryev/llx-plugin/loading'
import { readHooksJsonModules, type Monitor } from '@rsaryev/llx-plugin/format'
import { readJsonFile } from '../../../../lib/json'
import type { PluginMonitor } from '../../contracts-monitors'
import { isMcpBundle, loadMcpBundles, type McpBundles } from '../../mcpb-bundle'
import { readComponents, type PluginCcComponents } from './components'

/** Absolute paths and runtime configs of what a plugin the kit loaded contributes. */
export interface ResolvedEntrypoints {
  /** Skill root dirs, each holding `<name>/SKILL.md` (or the skill itself, at its root). */
  skillDirs: string[]
  /** MCP server configs keyed by server name. */
  mcpServers: Record<string, Record<string, unknown>>
  /** What the packaged servers declare: their settings, the required ones, load failures. */
  mcpBundles?: Pick<McpBundles, 'options' | 'required' | 'errors'>
  /** The command files, read as skills too (`plugin-command-skills.ts`). */
  commandFiles: Array<{ file: string; name: string }>
  /** The plugin's hooks, merged by the kit, as one settings block for the cc-hooks pipeline. */
  hookConfigs: unknown[]
  /** The hooks module (`modules` in `hooks/hooks.json`), absolute: the plugin is a mod. */
  hookModule?: string
  /** LSP server configs keyed by server id. */
  lspServers: Record<string, unknown>
  monitors: PluginMonitor[]
  components?: PluginCcComponents
}

const monitorOf = ({ name, command, description, when }: Monitor): PluginMonitor => ({
  name,
  command,
  description,
  when: when.kind === 'always' ? 'always' : `on-skill-invoke:${when.skill}`,
})

/** A skill's root: its folder's parent, or the folder itself when it is the plugin's one skill. */
function skillDirsOf(plugin: Plugin, dir: string): string[] {
  const roots = plugin.skills.flatMap(({ directory, alone }) => {
    if (directory === undefined) return []
    if (directory === '.') return [dir]
    return [alone ? join(dir, directory) : dirname(join(dir, directory))]
  })
  return [...new Set(roots)]
}

/**
 * The packaged servers (`.mcpb` / `.dxt`) the manifest names, opened by Localix's MCPB reader.
 * Decision: the kit is given no bundle reader (its bundle settings are being reworked), so its
 * "needs an extractor" warning is dropped where the issues are gathered.
 */
async function bundlesOf(plugin: Plugin, dir: string): Promise<McpBundles | undefined> {
  const field = plugin.manifest?.mcpServers
  const refs = (Array.isArray(field) ? field : [field]).filter(
    (ref): ref is string => typeof ref === 'string' && isMcpBundle(ref),
  )
  return refs.length ? loadMcpBundles(dir, refs) : undefined
}

async function hookModuleOf(dir: string): Promise<string | undefined> {
  const raw = await readJsonFile(join(dir, 'hooks', 'hooks.json'))
  const entry = raw === undefined || raw === null ? undefined : readHooksJsonModules(raw).entry
  return entry === undefined ? undefined : join(dir, entry)
}

export async function entrypointsOf(plugin: Plugin, dir: string): Promise<ResolvedEntrypoints> {
  const [bundles, hookModule, real] = await Promise.all([
    bundlesOf(plugin, dir),
    hookModuleOf(dir),
    // A command file is read as a skill confined to the plugin's real folder.
    realpath(dir).catch(() => dir),
  ])
  const mcpServers = {
    ...(plugin.mcpServers as Record<string, Record<string, unknown>>),
    ...bundles?.servers,
  }
  return {
    skillDirs: skillDirsOf(plugin, dir),
    mcpServers,
    ...(bundles ? { mcpBundles: bundles } : {}),
    commandFiles: plugin.commands.flatMap(({ path, name }) =>
      path === undefined ? [] : [{ file: join(real, path), name }],
    ),
    hookConfigs: Object.keys(plugin.hooks).length ? [{ hooks: plugin.hooks }] : [],
    ...(hookModule ? { hookModule } : {}),
    lspServers: { ...plugin.lspServers },
    monitors: plugin.monitors.map(monitorOf),
    components: readComponents(plugin, dir),
  }
}
