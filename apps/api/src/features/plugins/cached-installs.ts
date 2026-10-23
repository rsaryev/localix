import { pathExists } from '../ext/fs-discovery'
import type { DiscoveredPlugin } from './discovery-types'
import { loadManifest } from './manifest-load'
import { readInstallRecords } from './plugin-cache'
import { withWorkflowCommands } from './workflow-commands'

/**
 * The user-scope plugins installed from a marketplace into the version cache, read through their
 * records in `installed_plugins.json` (`plugin-cache.ts`). Each loads from the version folder its
 * record names, so an update that records a new version is what the next run loads, while the old
 * folder stays for whatever started from it. A record whose folder is gone shows nothing.
 */
export async function discoverCachedPlugins(opts: {
  homeDir: string
  projectId: string
}): Promise<DiscoveredPlugin[]> {
  const records = await readInstallRecords(opts.homeDir)
  const plugins = await Promise.all(
    Object.entries(records).map(async ([id, record]): Promise<DiscoveredPlugin | null> => {
      if (!(await pathExists(record.installPath))) return null
      const plugin = await loadManifest(record.installPath, 'global', opts.projectId)
      return { ...withWorkflowCommands(plugin), cachedInstall: { id, version: record.version } }
    }),
  )
  return plugins.filter((plugin): plugin is DiscoveredPlugin => plugin !== null)
}
