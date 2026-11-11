import {
  bundleSettingKey,
  type PluginManifest as KitManifest,
  type UserConfigOption,
} from '@rsaryev/llx-plugin/format'
import type { Plugin } from '@rsaryev/llx-plugin/loading'
import { pluginIdIssues } from '@rsaryev/llx-plugin/marketplace'
import type { LocalixManifest } from '../../contracts'
import type { PluginConfigOption } from '../../contracts-base'
import { issueLine } from './issue-line'

/**
 * The manifest Localix keeps for a plugin the kit loaded (`LocalixManifest`): the kit's, with the
 * plugin's options as Localix settings beside it.
 */

/** A `userConfig` option as a Localix setting: `sensitive` is `secret`, a list default its JSON. */
function settingOf(option: UserConfigOption): PluginConfigOption {
  const { sensitive, default: fallback, required, ...rest } = option
  return {
    ...rest,
    required: required ?? false,
    secret: sensitive ?? false,
    ...(fallback === undefined
      ? {}
      : { default: Array.isArray(fallback) ? JSON.stringify(fallback) : fallback }),
  }
}

const settingsOf = (options: Readonly<Record<string, UserConfigOption>>) =>
  Object.fromEntries(Object.entries(options).map(([key, option]) => [key, settingOf(option)]))

/** A packaged server's settings, keyed `<server>.<key>` among the plugin's. */
const bundleSettingsOf = (bundles: Plugin['mcpBundles']) =>
  Object.fromEntries(
    Object.entries(bundles).flatMap(([server, { userConfig }]) =>
      Object.entries(userConfig).map(([key, option]) => [
        bundleSettingKey(server, key),
        settingOf(option),
      ]),
    ),
  )

/**
 * A packaged server's and a channel's options join the plugin's, the plugin's own winning a shared
 * key.
 */
function configOf(
  manifest: KitManifest,
  bundles: Plugin['mcpBundles'],
): Record<string, PluginConfigOption> | undefined {
  const channels = Object.assign({}, ...(manifest.channels ?? []).map((c) => c.userConfig ?? {}))
  const config = {
    ...bundleSettingsOf(bundles),
    ...settingsOf(channels),
    ...settingsOf(manifest.userConfig ?? {}),
  }
  return Object.keys(config).length ? config : undefined
}

/** Why `name` cannot be part of a plugin id, and so cannot name an install folder (the kit's grammar). */
export function pluginNameRefusal(name: string): string | undefined {
  const refused = pluginIdIssues('plugin', name, 'name')[0]
  return refused && issueLine(refused)
}

export interface MappedManifest {
  readonly manifest: LocalixManifest
  readonly error?: string
}

/**
 * The Localix manifest of a plugin the kit loaded: the kit's own, under the name the kit loaded it
 * by, with its options as settings. A name that cannot be part of a plugin id (the kit's grammar)
 * cannot name an install folder: that is the error, the plugin kept under `fallbackName`.
 */
export function localixManifest(plugin: Plugin, fallbackName: string): MappedManifest {
  const refused = pluginNameRefusal(plugin.name)
  if (refused) return { manifest: { name: fallbackName }, error: refused }
  const kit = plugin.manifest
  if (!kit) return { manifest: { name: plugin.name } }
  const config = configOf(kit, plugin.mcpBundles)
  return {
    manifest: {
      ...kit,
      name: plugin.name,
      origin: { format: 'claude-code' },
      ...(config ? { config } : {}),
    },
  }
}
