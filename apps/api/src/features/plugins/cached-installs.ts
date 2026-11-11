import { pathExists } from '../ext/fs-discovery'
import type { DiscoveredPlugin } from './discovery-types'
import { loadMarketplaceCopy } from './marketplace-copy'
import { readInstallRecords } from './plugin-cache'
import { withWorkflowCommands } from './workflow-commands'

/**
 * The user-scope plugins installed from a marketplace into the version cache, read through their
 * records in `installed_plugins.json` (`plugin-cache.ts`), each with its entry (`marketplace-copy.ts`);
 * with `projectPath`, the copies a project-scope install recorded for that project. Each loads from the version folder its
 * record names, so an update that records a new version is what the next run loads, while the old
 * folder stays for whatever started from it. A record whose folder is gone shows nothing.
 */
export async function discoverCachedPlugins(opts: {
  homeDir: string
  projectId: string
  /** A project's recorded copies instead (`scope: "project"`), under its `.localix/plugins`. */
  projectPath?: string
}): Promise<DiscoveredPlugin[]> {
  const records = await readInstallRecords(opts.homeDir, opts.projectPath)
  const plugins = await Promise.all(
    Object.entries(records).map(async ([id, record]): Promise<DiscoveredPlugin | null> => {
      if (!(await pathExists(record.installPath))) return null
      const plugin = await loadMarketplaceCopy(record.installPath, id, {
        scope: opts.projectPath === undefined ? 'global' : 'project',
        projectId: opts.projectId,
        homeDir: opts.homeDir,
      })
      const cachedInstall = {
        id,
        version: record.version,
        ...(opts.projectPath === undefined ? {} : { projectPath: opts.projectPath }),
      }
      return { ...withWorkflowCommands(plugin), cachedInstall }
    }),
  )
  return plugins.filter((plugin): plugin is DiscoveredPlugin => plugin !== null)
}
