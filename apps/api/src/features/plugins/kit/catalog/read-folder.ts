import { basename } from 'node:path'
import { readCatalog } from '@rsaryev/llx-plugin'
import { loadPlugin, type Plugin } from '@rsaryev/llx-plugin/loading'
import type { PluginIssue } from '@rsaryev/llx-plugin/format'
import type { MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import { CC_INERT_HOOK_EVENTS, isInertCcHookEvent } from '../../../cc-hooks/contracts'
import type { DiscoveredPlugin } from '../../discovery-types'
import { diskFiles } from '../ports/files'
import { mcpBundleReader } from '../ports/mcp-bundle'
import { readCommands } from './components'
import { entrypointsOf } from './entrypoints'
import { issueLine } from './issue-line'
import { localixManifest } from './manifest'

/**
 * One plugin folder read by the kit (`loadPlugin`, then its format readers) into what Localix's
 * catalog, validation and runtime take. Never throws: what kept it from loading is `error`.
 */

const MINI_APP = '.localix-mini-app/mini-app.json'
const MINI_APP_REFUSAL =
  'This folder is a mini app (.localix-mini-app/mini-app.json), not a plugin: add it from the Store'

/** What else names the plugin: its marketplace entry (as the kit read the catalog), a name. */
export interface FolderSource {
  readonly entry?: MarketplaceEntry
  /** The name of a plugin with neither a manifest nor an entry; the folder's name otherwise. */
  readonly name?: string
}

export type CatalogPlugin = Omit<DiscoveredPlugin, 'scope' | 'projectId'>

const isError = (found: PluginIssue) => found.severity === 'error'

function empty(
  dir: string,
  name: string,
  error: string,
  issues: readonly PluginIssue[],
): CatalogPlugin {
  return {
    manifest: { name },
    dir,
    entrypoints: {
      mcpServers: {},
      hookConfigs: [],
      lspServers: {},
      monitors: [],
    },
    provides: { skills: [], mcpServers: [], commands: [] },
    commands: [],
    agents: [],
    error,
    ...(issues.length ? { manifestIssues: [...issues] } : {}),
  }
}

/** A hook on an event Localix accepts but never fires, with the reason its author is shown. */
const inertHookIssues = (plugin: Plugin): PluginIssue[] =>
  Object.keys(plugin.hooks)
    .filter(isInertCcHookEvent)
    .map((event) => ({
      severity: 'warning',
      path: 'hooks',
      message: `Hook event ${event} never fires in Localix: ${CC_INERT_HOOK_EVENTS[event]}`,
    }))

async function catalogOf(
  dir: string,
  plugin: Plugin,
  loadIssues: readonly PluginIssue[],
  fallbackName: string,
): Promise<CatalogPlugin> {
  const mapped = localixManifest(plugin, fallbackName)
  const commands = readCommands(plugin)
  const { agents } = readCatalog(plugin)
  const entrypoints = await entrypointsOf(plugin, dir)
  const agentNames = [...new Set(agents.map((agent) => agent.scopedName))]
  const lspNames = Object.keys(entrypoints.lspServers)
  const manifestIssues = [
    ...loadIssues,
    ...inertHookIssues(plugin),
    // What the format readers found in its skills, commands, agents and output styles.
    ...readCatalog(plugin).issues,
  ]
  return {
    manifest: mapped.manifest,
    kit: plugin,
    dir,
    entrypoints,
    provides: {
      skills: plugin.skills.map((skill) => skill.name),
      mcpServers: Object.keys(entrypoints.mcpServers),
      commands: commands.commands.map((command) => command.name),
      ...(agentNames.length ? { agents: agentNames } : {}),
      ...(lspNames.length ? { lspServers: lspNames } : {}),
    },
    commands: commands.commands,
    agents,
    ...(mapped.error ? { error: mapped.error } : {}),
    ...(manifestIssues.length ? { manifestIssues } : {}),
  }
}

/** Read the plugin in `dir`, merged with its marketplace entry when it has one. */
export async function readPluginFolder(
  dir: string,
  from: FolderSource = {},
): Promise<CatalogPlugin> {
  const disk = diskFiles(dir)
  const fallbackName = from.name ?? basename(dir)
  if (await disk.exists(MINI_APP)) return empty(dir, fallbackName, MINI_APP_REFUSAL, [])
  const { entry } = from
  // The kit merges the entry with `plugin.json` itself (`mergeEntryWithManifest`).
  const loaded = await loadPlugin({
    files: disk,
    fallbackName,
    // A packaged server (`.mcpb`) is unpacked under the plugin; the kit reads what it declares.
    bundles: mcpBundleReader(dir),
    ...(entry ? { entry } : {}),
  })
  const issues = loaded.issues
  if (!loaded.plugin) {
    const error = issues.find(isError)
    return empty(dir, entry?.name ?? fallbackName, error ? issueLine(error) : 'Not loaded', issues)
  }
  return catalogOf(dir, loaded.plugin, issues, fallbackName)
}
