import { NotFoundError } from '../../lib/domain-errors'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  PLUGIN_UI_ARTIFACT_DIR,
  PLUGIN_UI_ARTIFACT_MANIFEST,
  isPluginUiArtifactManifest,
} from '@localixai/plugin-sdk/ui-artifact'

import { isPathBelow } from '../../lib/path-containment'
import type { PluginCatalog } from './catalog'
import type { PluginUiDescriptor } from './contracts'
import type { DiscoveredPlugin } from './discovery'

/**
 * A plugin's workbench UI, as the API advertises and serves it.
 *
 * The UI is a built artifact inside the plugin's directory (`dist/ui/`: written by staging for a
 * first-party plugin, by the app's own build for a user plugin), not source compiled into the
 * host. The API reads the artifact's own manifest into the plugin record — the host imports the
 * entry by URL and replaces the plugin when `revision` moves — and serves the files under
 * {@link pluginUiUrl}. Nothing outside the artifact directory is ever served.
 *
 * Native UI runs in the host's page, so it follows the same trust rule as a native backend: a
 * first-party plugin ships trusted, anything else needs the user's consent (its enable rule)
 * before a byte of it is served. The host imports only what its snapshot lists as enabled.
 */

export const PLUGIN_UI_ROUTE = '/rpc/plugins'

/** Where the host fetches `file` of `pluginName`'s artifact. */
export function pluginUiUrl(pluginName: string, file: string): string {
  return `${PLUGIN_UI_ROUTE}/${encodeURIComponent(pluginName)}/ui/${file}`
}

function artifactDir(plugin: DiscoveredPlugin): string {
  return join(plugin.dir, PLUGIN_UI_ARTIFACT_DIR)
}

/**
 * The record's `ui` field: read FRESH from the artifact on every record build, because discovery
 * caches by manifest mtime and a rebuilt UI changes no `plugin.json`. Undefined for a plugin
 * without an artifact.
 */
export async function readPluginUiDescriptor(
  plugin: DiscoveredPlugin,
): Promise<PluginUiDescriptor | undefined> {
  let manifest: unknown
  try {
    manifest = JSON.parse(
      await fs.readFile(join(artifactDir(plugin), PLUGIN_UI_ARTIFACT_MANIFEST), 'utf8'),
    )
  } catch {
    return undefined
  }
  if (!isPluginUiArtifactManifest(manifest)) return undefined
  const name = plugin.manifest.name
  return {
    entry: pluginUiUrl(name, manifest.entry),
    styles: manifest.styles.map((style) => pluginUiUrl(name, style)),
    revision: manifest.revision,
  }
}

/**
 * The absolute path of one artifact file, or a 404. A first-party plugin's files are served
 * whatever its enablement — inert code the host imports only when its snapshot says enabled, and
 * a module URL carries no project scope to check enablement against. Any other plugin's files are
 * served only once the user consented to it.
 */
export function resolvePluginUiFile(
  catalog: PluginCatalog,
  pluginName: string,
  file: string,
): string {
  const entry = catalog.all.find(({ plugin }) => plugin.manifest.name === pluginName)
  if (!entry || (!entry.plugin.bundled && !entry.enabled)) {
    throw new NotFoundError('plugin_ui_not_found', `Plugin "${pluginName}" ships no UI`)
  }
  const root = artifactDir(entry.plugin)
  const path = resolve(root, file)
  if (!isPathBelow(root, path)) {
    throw new NotFoundError('plugin_ui_not_found', 'UI file must live inside the UI artifact')
  }
  return path
}
