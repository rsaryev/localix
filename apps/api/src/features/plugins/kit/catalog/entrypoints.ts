import { join } from 'node:path'
import type { Plugin } from '@rsaryev/llx-plugin/loading'
import { readHooksJsonModules, resolveTypesPath } from '@rsaryev/llx-plugin/format'
import { readJsonFile } from '../../../../lib/json'
import { readComponents, type PluginCcComponents } from './components'

/**
 * What a plugin the kit loaded contributes, as the kit read it (its MCP and LSP servers and its
 * monitors, packaged `.mcpb` servers among the MCP ones), plus what Localix derives from it: the
 * plugin's merged hooks as one settings block for the cc-hooks pipeline, its hooks module (the
 * plugin is a mod) and its components.
 */
export type ResolvedEntrypoints = Pick<Plugin, 'mcpServers' | 'lspServers' | 'monitors'> & {
  hookConfigs: unknown[]
  /** The hooks module (`modules` in `hooks/hooks.json`), absolute. */
  hookModule?: string
  /** The hooks module's types file (the manifest's `types`, else `types/index.d.ts`), absolute. */
  hookTypes?: string
  components?: PluginCcComponents
}

async function hookModuleOf(dir: string): Promise<string | undefined> {
  const raw = await readJsonFile(join(dir, 'hooks', 'hooks.json'))
  const entry = raw === undefined || raw === null ? undefined : readHooksJsonModules(raw).entry
  return entry === undefined ? undefined : join(dir, entry)
}

export async function entrypointsOf(plugin: Plugin, dir: string): Promise<ResolvedEntrypoints> {
  const hookModule = await hookModuleOf(dir)
  const types = hookModule ? resolveTypesPath(plugin.manifest ?? {}) : undefined
  return {
    mcpServers: plugin.mcpServers,
    hookConfigs: Object.keys(plugin.hooks).length ? [{ hooks: plugin.hooks }] : [],
    ...(hookModule ? { hookModule } : {}),
    ...(types ? { hookTypes: join(dir, types) } : {}),
    lspServers: plugin.lspServers,
    monitors: plugin.monitors,
    components: readComponents(plugin, dir),
  }
}
