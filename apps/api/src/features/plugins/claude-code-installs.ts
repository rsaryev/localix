import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { MANIFEST_FILE, MARKETPLACE_FILE } from '@localixai/claude-plugin'

import { claudeConfigDir } from '../cc-settings/config-dir'
import {
  readSettingsLayers,
  type SettingsFilesInput,
  type SettingsLayer,
} from '../cc-settings/settings-files'
import { pathExists } from '../ext/fs-discovery'
import { isRecord } from '../../lib/record'
import type { DiscoveredPlugin } from './discovery-types'
import type { ManifestFiles } from './layout/compose'
import { loadManifest } from './manifest-load'
import { resolveEntrySource } from './marketplace-entry-source'
import {
  entryHasManifestOverrides,
  mergeEntryOverrides,
  synthesizeEntryManifest,
} from './marketplace-entry-manifest'
import type { MarketplaceEntry } from './marketplace'
import { withWorkflowCommands } from './workflow-commands'

/**
 * THE PLUGINS A PERSON INSTALLED IN CLAUDE CODE, read where Claude Code keeps them.
 *
 * Claude Code records an install in `~/.claude/plugins/installed_plugins.json` (`{ version: 2,
 * plugins: { "<name>@<marketplace>": [{ scope, projectPath?, installPath, version }] } }`, the
 * files under `cache/`) and decides what loads from `enabledPlugins` in the user's
 * `~/.claude/settings.json`, the project's `.claude/settings.json` and `.claude/settings.local.json`
 * — merged key by key, the later file winning. A plugin listed by relative path in a marketplace
 * loads from the marketplace's folder (`known_marketplaces.json` → `installLocation`) with no
 * install record. This module answers the same question Claude Code does at session start, from
 * the same files, without the network.
 *
 * READ ONLY, and read in place: nothing here writes under `~/.claude`, and a plugin's
 * `${CLAUDE_PLUGIN_DATA}` stays Localix's own. What the plugin may do is still Localix's decision:
 * a folder Claude Code installed is `untrusted` like any other, so it is asked about before it
 * runs (`ext/trust.ts`). `CLAUDE_CONFIG_DIR` moves the folder these files are read from.
 */
type CcScope = 'user' | 'project' | 'local'
/** The settings file that decided a plugin: a scope, or the managed settings (`policy`). */
type EnabledBy = CcScope | 'policy'

export interface ClaudeCodeInstall {
  /** `<name>@<marketplace>`, Claude Code's key. */
  id: string
  dir: string
  /** `project` when the install or the setting that turns it on belongs to the project. */
  scope: 'global' | 'project'
  /** The settings file that turned it on, or undefined when only the manifest's default does. */
  enabledBy?: EnabledBy
  /** Its marketplace entry, which Claude Code combines with the plugin's own manifest. */
  entry?: MarketplaceEntry
}

interface InstallRecord {
  scope: CcScope
  projectPath?: string
  installPath: string
}

const SCOPES = new Set<CcScope>(['user', 'project', 'local'])

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/**
 * `enabledPlugins` across the settings files Claude Code reads (`cc-settings/settings-files.ts`),
 * lowest precedence first, the later file winning key by key; managed settings come last, so a
 * plugin they turn off is blocked and one they turn on cannot be turned off.
 */
async function enabledPlugins(
  input: SettingsFilesInput,
): Promise<Map<string, { on: boolean; source: EnabledBy }>> {
  const merged = new Map<string, { on: boolean; source: EnabledBy }>()
  for (const { source, settings } of await readSettingsLayers(input)) {
    if (source === 'flag' || !isRecord(settings.enabledPlugins)) continue
    for (const [id, value] of Object.entries(settings.enabledPlugins))
      if (typeof value === 'boolean') merged.set(id, { on: value, source })
  }
  return merged
}

/** The install records by plugin id; version 1 kept one object per id instead of a list. */
function installRecords(raw: unknown): Map<string, InstallRecord[]> {
  const out = new Map<string, InstallRecord[]>()
  if (!isRecord(raw) || !isRecord(raw.plugins)) return out
  for (const [id, value] of Object.entries(raw.plugins)) {
    const records = (Array.isArray(value) ? value : [value]).flatMap((entry): InstallRecord[] => {
      if (!isRecord(entry) || typeof entry.installPath !== 'string') return []
      const scope = SCOPES.has(entry.scope as CcScope) ? (entry.scope as CcScope) : 'user'
      return [
        {
          scope,
          installPath: entry.installPath,
          ...(typeof entry.projectPath === 'string' ? { projectPath: entry.projectPath } : {}),
        },
      ]
    })
    if (records.length) out.set(id, records)
  }
  return out
}

/** The record that applies here: one made for this project first, else the user's. */
function applicable(records: InstallRecord[], cwd: string | null): InstallRecord | undefined {
  const here = cwd ? resolve(cwd) : null
  const forProject = records.filter(
    (r) => r.scope !== 'user' && here !== null && r.projectPath && resolve(r.projectPath) === here,
  )
  return (
    forProject.find((r) => r.scope === 'local') ??
    forProject[0] ??
    records.find((r) => r.scope === 'user')
  )
}

interface Listing {
  entry: MarketplaceEntry
  /** Where a relative-path entry loads from, inside the marketplace's folder. */
  localPath?: string
}

/** The plugin's entry in the marketplace Claude Code fetched (`known_marketplaces.json`). */
async function marketplaceListing(known: unknown, id: string): Promise<Listing | undefined> {
  const at = id.lastIndexOf('@')
  const record = at > 0 && isRecord(known) ? known[id.slice(at + 1)] : undefined
  if (!isRecord(record) || typeof record.installLocation !== 'string') return undefined
  const catalog = await readJson(join(record.installLocation, MARKETPLACE_FILE))
  if (!isRecord(catalog) || !Array.isArray(catalog.plugins)) return undefined
  const entry = catalog.plugins.find(
    (item): item is MarketplaceEntry => isRecord(item) && item.name === id.slice(0, at),
  )
  if (!entry) return undefined
  if (typeof entry.source !== 'string') return { entry }
  const pluginRoot = isRecord(catalog.metadata) ? catalog.metadata.pluginRoot : undefined
  try {
    const resolved = resolveEntrySource(
      record.installLocation,
      entry,
      typeof pluginRoot === 'string' ? { pluginRoot } : {},
    )
    return 'localPath' in resolved ? { entry, localPath: resolved.localPath } : { entry }
  } catch {
    return { entry }
  }
}

/**
 * The manifests Claude Code reads for the plugin: with no `plugin.json`, the entry is the manifest
 * (the official `*-lsp` plugins ship none); else the entry is combined into it, as an install does
 * on disk (`marketplace-entry-manifest.ts`). A plugin without either is named by its entry, not by
 * its cache folder (a version).
 */
export function withEntry(id: string, entry: MarketplaceEntry | undefined) {
  return (read: ManifestFiles): ManifestFiles => {
    // Claude Code never reads a root `plugin.json`, so its fields do not count.
    const { root: _ignored, ...files } = read
    const plugin = files.plugin
    if (!plugin && !files.miniApp) {
      let json: Record<string, unknown> = { name: id.slice(0, id.lastIndexOf('@')) || id }
      try {
        if (entry) json = synthesizeEntryManifest(entry)
      } catch {
        // Hooks an entry writes as a path are refused at install too; the name still holds.
      }
      return { ...files, plugin: { file: MANIFEST_FILE, json } }
    }
    if (!entry || !plugin || !('json' in plugin) || !isRecord(plugin.json)) return files
    if (!entryHasManifestOverrides(entry)) return files
    try {
      return { ...files, plugin: { ...plugin, json: mergeEntryOverrides(plugin.json, entry) } }
    } catch (error) {
      return { ...files, plugin: { file: plugin.file, readError: (error as Error).message } }
    }
  }
}

/** What Claude Code would load for a session in `cwd` (null: no project). */
export async function readClaudeCodeInstalls(
  opts: Pick<SettingsFilesInput, 'homeDir' | 'cwd' | 'env' | 'managed'>,
): Promise<ClaudeCodeInstall[]> {
  const pluginsRoot = join(claudeConfigDir(opts.homeDir, opts.env), 'plugins')
  const [records, enabled, known] = await Promise.all([
    readJson(join(pluginsRoot, 'installed_plugins.json')).then(installRecords),
    enabledPlugins(opts),
    readJson(join(pluginsRoot, 'known_marketplaces.json')),
  ])
  const ids = [...new Set([...records.keys(), ...enabled.keys()])].sort()
  const installs = await Promise.all(
    ids.map(async (id): Promise<ClaudeCodeInstall | null> => {
      const setting = enabled.get(id)
      if (setting?.on === false) return null
      const record = applicable(records.get(id) ?? [], opts.cwd)
      if (!record && !setting?.on) return null
      const listing = await marketplaceListing(known, id)
      const dir =
        record && (await pathExists(record.installPath)) ? record.installPath : listing?.localPath
      if (!dir || !(await pathExists(dir))) return null
      const projectOwned = record
        ? record.scope !== 'user'
        : setting?.source === 'project' || setting?.source === 'local'
      return {
        id,
        dir,
        scope: projectOwned ? 'project' : 'global',
        ...(setting ? { enabledBy: setting.source } : {}),
        ...(listing ? { entry: listing.entry } : {}),
      }
    }),
  )
  return installs.filter((install): install is ClaudeCodeInstall => install !== null)
}

/**
 * The values a person gave a plugin's options in Claude Code (`pluginConfigs["<id>"].options`,
 * settings-reference.md): read from the user and managed settings only — Claude Code ignores
 * project and local entries, since it substitutes them into hooks and servers. Sensitive options
 * live in the OS keychain, which Localix does not read; they are asked for here.
 */
function claudeCodeOptions(layers: readonly SettingsLayer[], id: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const layer of layers) {
    if (layer.source !== 'user' && layer.source !== 'policy') continue
    const configs = layer.settings.pluginConfigs
    const entry = isRecord(configs) ? configs[id] : undefined
    if (isRecord(entry) && isRecord(entry.options)) Object.assign(out, entry.options)
  }
  return out
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
  managed?: SettingsFilesInput['managed']
}): Promise<DiscoveredPlugin[]> {
  const [installs, layers] = await Promise.all([
    readClaudeCodeInstalls(opts).catch(() => []),
    readSettingsLayers(opts).catch(() => [] as SettingsLayer[]),
  ])
  const plugins = await Promise.all(
    installs.map(async (install): Promise<DiscoveredPlugin | null> => {
      const scope = install.scope === 'project' && opts.projectId ? 'project' : 'global'
      const plugin = withWorkflowCommands(
        await loadManifest(
          install.dir,
          scope,
          opts.projectId,
          withEntry(install.id, install.entry),
        ),
      )
      if (!install.enabledBy && plugin.manifest.defaultEnabled === false) return null
      return {
        ...plugin,
        manifest: withClaudeCodeOptions(plugin.manifest, claudeCodeOptions(layers, install.id)),
        claudeCodeInstall: install.id,
      }
    }),
  )
  return plugins.filter((plugin): plugin is DiscoveredPlugin => plugin !== null)
}
