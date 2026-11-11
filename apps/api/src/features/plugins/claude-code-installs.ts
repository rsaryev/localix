import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { listItems } from './config-lists'

import { claudeConfigDir } from '../cc-settings/config-dir'
import { pathExists } from '../ext/fs-discovery'
import type { DiscoveredPlugin } from './discovery-types'
import {
  catalogAt,
  claudeCodePluginSettings,
  hostPlatform,
  installsAt,
  parseInstalledPlugins,
  readKnownMarketplaces,
  readMarketplace,
  resolveEntrySource,
  type KnownMarketplaces,
  type ClaudeSettingsInput,
  type FolderSource,
} from './kit'
import type { MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import type { FileScope } from '@rsaryev/llx-plugin/settings'
import { loadManifest } from './manifest-load'
import { withWorkflowCommands } from './workflow-commands'

/**
 * THE PLUGINS A PERSON INSTALLED IN CLAUDE CODE, read where Claude Code keeps them.
 *
 * Claude Code records an install in `~/.claude/plugins/installed_plugins.json` (the files under
 * `cache/`) and decides what loads from `enabledPlugins` across its settings files, both read by
 * the kit (`parseInstalledPlugins`, `claudeCodePluginSettings` in `./kit`). A plugin listed by relative path in a marketplace
 * loads from the marketplace's folder (`known_marketplaces.json` → `installLocation`) with no
 * install record. This module answers the same question Claude Code does at session start, from
 * the same files, without the network.
 *
 * READ ONLY, and read in place: nothing here writes under `~/.claude`, and a plugin's
 * `${CLAUDE_PLUGIN_DATA}` stays Localix's own. What the plugin may do is still Localix's decision:
 * a folder Claude Code installed is `untrusted` like any other, so it is asked about before it
 * runs (`ext/trust.ts`). `CLAUDE_CONFIG_DIR` moves the folder these files are read from.
 */
export interface ClaudeCodeInstall {
  /** `<name>@<marketplace>`, Claude Code's key. */
  id: string
  dir: string
  /** `project` when the install or the setting that turns it on belongs to the project. */
  scope: 'global' | 'project'
  /** The settings file that turned it on, or undefined when only the manifest's default does. */
  enabledBy?: FileScope
  /** Its marketplace entry, which Claude Code combines with the plugin's own manifest. */
  entry?: MarketplaceEntry
}

type InstallsInput = Pick<ClaudeSettingsInput, 'homeDir' | 'cwd' | 'env' | 'managed'>

/** The scopes whose record applies here, in order: one made for this project first, else the user's. */
const PICK = ['local', 'project', 'user'] as const

interface Listing {
  /** The entry as the kit read the catalog; the kit merges it with the plugin's manifest. */
  entry: MarketplaceEntry
  /** Where a relative-path entry loads from, inside the marketplace's folder. */
  localPath?: string
}

/** The plugin's entry in the marketplace Claude Code fetched (`known_marketplaces.json`). */
async function marketplaceListing(
  known: KnownMarketplaces,
  id: string,
): Promise<Listing | undefined> {
  const at = id.lastIndexOf('@')
  const record = at > 0 ? known[id.slice(at + 1)] : undefined
  if (!record) return undefined
  const name = id.slice(0, at)
  let entry: MarketplaceEntry | undefined
  try {
    entry = (await readMarketplace(record)).plugins.find((one) => one.name === name)
  } catch {
    return undefined
  }
  if (!entry) return undefined
  try {
    const resolved = resolveEntrySource(catalogAt(record).root, entry, record.source)
    return 'localPath' in resolved ? { entry, localPath: resolved.localPath } : { entry }
  } catch {
    return { entry }
  }
}

/**
 * What names the plugin besides its folder: its marketplace entry, merged into its manifest by the
 * kit (`kit/catalog`), and the id's name for a plugin with neither (not its cache folder, a version).
 */
export const entrySource = (id: string, entry?: MarketplaceEntry): FolderSource => ({
  ...(entry === undefined ? {} : { entry }),
  name: id.slice(0, id.lastIndexOf('@')) || id,
})

/** What Claude Code would load for a session in `cwd` (null: no project). */
export async function readClaudeCodeInstalls(opts: InstallsInput): Promise<ClaudeCodeInstall[]> {
  // `CLAUDE_CODE_PLUGIN_CACHE_DIR` moves Claude Code's plugins root, as in Claude Code.
  const pluginsRoot =
    (opts.env ?? process.env).CLAUDE_CODE_PLUGIN_CACHE_DIR?.trim() ||
    join(claudeConfigDir(opts.homeDir, opts.env), 'plugins')
  const [file, settings, known] = await Promise.all([
    fs.readFile(join(pluginsRoot, 'installed_plugins.json'), 'utf8').catch(() => undefined),
    claudeCodePluginSettings(opts),
    readKnownMarketplaces(pluginsRoot),
  ])
  // A file this version cannot read is no installs.
  const { records } = parseInstalledPlugins(file)
  const here = installsAt(records, {
    ...(opts.cwd ? { projectPath: resolve(opts.cwd) } : {}),
    platform: hostPlatform(),
  })
  const ids = [...new Set([...Object.keys(records), ...settings.ids])].sort()
  const installs = await Promise.all(
    ids.map(async (id): Promise<ClaudeCodeInstall | null> => {
      const setting = settings.enabled(id)
      if (setting?.on === false) return null
      const applying = here[id] ?? []
      const record = PICK.map((scope) => applying.find((r) => r.scope === scope)).find(Boolean)
      if (!record && !setting?.on) return null
      const listing = await marketplaceListing(known, id)
      const dir =
        record && (await pathExists(record.installPath)) ? record.installPath : listing?.localPath
      if (!dir || !(await pathExists(dir))) return null
      const projectOwned = record
        ? record.scope !== 'user'
        : setting?.by === 'project' || setting?.by === 'local'
      return {
        id,
        dir,
        scope: projectOwned ? 'project' : 'global',
        ...(setting ? { enabledBy: setting.by } : {}),
        ...(listing ? { entry: listing.entry } : {}),
      }
    }),
  )
  return installs.filter((install): install is ClaudeCodeInstall => install !== null)
}

/** The manifest with Claude Code's option values as the options' defaults. */
function withClaudeCodeOptions<T extends { config?: Record<string, { default?: unknown }> }>(
  manifest: T,
  options: Record<string, unknown>,
): T {
  if (!manifest.config || Object.keys(options).length === 0) return manifest
  const config = Object.fromEntries(
    Object.entries(manifest.config).map(([key, option]) => [
      key,
      key in options && options[key] !== null && typeof options[key] !== 'object'
        ? { ...option, default: options[key] }
        : // A `multiple` option's list, kept as its JSON array (`config-lists.ts`).
          Array.isArray(options[key]) && listItems(options[key])
          ? { ...option, default: JSON.stringify(options[key]) }
          : option,
    ]),
  )
  return { ...manifest, config }
}

/**
 * The Claude Code installs as discovered plugins of the scope. One that no settings file turns on
 * loads only when its manifest does not say `defaultEnabled: false`, as in Claude Code. The values
 * its options were given in Claude Code are their defaults here; a value set in Localix wins.
 */
export async function discoverClaudeCodePlugins(opts: {
  homeDir: string
  cwd: string | null
  projectId: string
  env?: Record<string, string | undefined>
  managed?: InstallsInput['managed']
}): Promise<DiscoveredPlugin[]> {
  const [installs, settings] = await Promise.all([
    readClaudeCodeInstalls(opts).catch(() => []),
    claudeCodePluginSettings(opts),
  ])
  const plugins = await Promise.all(
    installs.map(async (install): Promise<DiscoveredPlugin | null> => {
      const scope = install.scope === 'project' && opts.projectId ? 'project' : 'global'
      const plugin = withWorkflowCommands(
        await loadManifest(
          install.dir,
          scope,
          opts.projectId,
          entrySource(install.id, install.entry),
        ),
      )
      if (!install.enabledBy && plugin.manifest.defaultEnabled === false) return null
      return {
        ...plugin,
        manifest: withClaudeCodeOptions(plugin.manifest, settings.options(install.id)),
        claudeCodeInstall: install.id,
      }
    }),
  )
  return plugins.filter((plugin): plugin is DiscoveredPlugin => plugin !== null)
}
