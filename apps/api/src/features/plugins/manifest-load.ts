import type { DiscoveredPlugin } from './discovery-types'
import { readPluginFolder, type FolderSource } from './kit'

/**
 * One plugin folder as a discovered plugin of `scope`: read by the kit (`kit/catalog`), with what
 * else names it (`from`: its marketplace entry, a name). Never throws.
 */
export async function loadManifest(
  dir: string,
  scope: 'global' | 'project',
  projectId: string,
  from?: FolderSource,
): Promise<DiscoveredPlugin> {
  return { ...(await readPluginFolder(dir, from)), scope, projectId }
}
