import { resolvePluginVersion, type VersionInput } from '@rsaryev/llx-plugin/marketplace'
import { nodeSha256 } from '../ports/marketplace-io'

/**
 * The version of an installed plugin, computed by the kit (`resolvePluginVersion`; plugins/
 * loading.md, "How Claude Code computes the version") over Localix's sha256 port. The version
 * names the cache folder and is how an update is detected: an unchanged version installs nothing.
 */
export async function pluginVersion(input: VersionInput): Promise<string> {
  return (await resolvePluginVersion(input, nodeSha256)).version
}

export { UNKNOWN_VERSION } from '@rsaryev/llx-plugin/marketplace'
