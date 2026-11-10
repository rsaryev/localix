import { basename } from 'node:path'
import { readCatalog } from '@rsaryev/llx-plugin'
import { loadPlugin, type Plugin } from '@rsaryev/llx-plugin/loading'
import type { PluginIssue } from '@rsaryev/llx-plugin/format'
import { parsePluginSource, readEntry } from '@rsaryev/llx-plugin/marketplace'
import { CC_INERT_HOOK_EVENTS, isInertCcHookEvent } from '../../../cc-hooks/contracts'
import type { DiscoveredPlugin } from '../../discovery-types'
import { diskFiles } from '../ports/files'
import { readAgents, readCommands } from './components'
import { entrypointsOf } from './entrypoints'
import { localixManifest } from './manifest'

/**
 * One plugin folder read by the kit (`loadPlugin`, then its format readers) into what Localix's
 * catalog, validation and runtime take. Never throws: what kept it from loading is `error`.
 */

const MINI_APP = '.localix-mini-app/mini-app.json'
const MINI_APP_REFUSAL =
  'This folder is a mini app (.localix-mini-app/mini-app.json), not a plugin: add it from the Store'

/** What else names the plugin: its marketplace entry (raw, as the marketplace lists it), a name. */
export interface FolderSource {
  readonly entry?: unknown
  /** The name of a plugin with neither a manifest nor an entry; the folder's name otherwise. */
  readonly name?: string
}

export type CatalogPlugin = Omit<DiscoveredPlugin, 'scope' | 'projectId'>

/** The marketplace entry as the kit reads it; one it cannot read leaves the plugin to its own manifest. */
const entryOf = (raw: unknown) =>
  raw === undefined ? undefined : readEntry(raw, { index: 0, context: {} }, parsePluginSource).entry

/** An issue as one line: its message, then where it is unless the message already says so. */
export const issueLine = ({ message, path }: PluginIssue): string =>
  message.includes(path) ? message : `${message} (${path})`

/**
 * Kit gap: `loadPlugin` decides at load whether a bundled server may start, from `bundleSettings`,
 * while a catalog folder is read once for every scope and Localix keeps a plugin's settings per
 * project; and `McpBundleSetting` carries no title, type or description for the settings form. So
 * the catalog gives the kit no bundle reader, Localix's own (`entrypoints.ts`) reads the bundles,
 * and the kit's "needs an extractor" warning is not the person's to see.
 */
const NOT_EXTRACTED = /^MCP bundle .* needs an extractor/
const isError = (found: PluginIssue) => found.severity === 'error'

function empty(
  dir: string,
  name: string,
  error: string,
  issues: readonly PluginIssue[],
): CatalogPlugin {
  return {
    manifest: { name, version: '0.0.0', description: '' },
    dir,
    entrypoints: {
      skillDirs: [],
      mcpServers: {},
      commandFiles: [],
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
  const mapped = localixManifest(plugin.name, plugin.manifest, fallbackName)
  const commands = readCommands(plugin)
  const agents = readAgents(plugin)
  const entrypoints = await entrypointsOf(plugin, dir)
  const agentNames = [...new Set(agents.agents.map((agent) => `${plugin.name}:${agent.name}`))]
  const lspNames = Object.keys(entrypoints.lspServers)
  const manifestIssues = [
    ...loadIssues,
    ...inertHookIssues(plugin),
    // What the format readers found in its skills, commands, agents and output styles.
    ...readCatalog(plugin).issues,
    ...(entrypoints.mcpBundles?.errors ?? []).map((message): PluginIssue => ({
      severity: 'error',
      path: 'mcpServers',
      message,
    })),
  ]
  // A packaged server's options join the plugin's settings (`<server>.<key>`); the plugin's own win.
  const config = { ...entrypoints.mcpBundles?.options, ...mapped.manifest.config }
  return {
    manifest: Object.keys(config).length ? { ...mapped.manifest, config } : mapped.manifest,
    ...(plugin.manifest ? { rawManifest: { ...plugin.manifest } } : {}),
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
    agents: agents.agents,
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
  const entry = entryOf(from.entry)
  // The kit merges the entry with `plugin.json` itself (`mergeEntryWithManifest`).
  const loaded = await loadPlugin({
    files: disk,
    fallbackName,
    ...(entry ? { entry } : {}),
  })
  const issues = loaded.issues.filter((found) => !NOT_EXTRACTED.test(found.message))
  if (!loaded.plugin) {
    const error = issues.find(isError)
    return empty(dir, entry?.name ?? fallbackName, error ? issueLine(error) : 'Not loaded', issues)
  }
  return catalogOf(dir, loaded.plugin, issues, fallbackName)
}
