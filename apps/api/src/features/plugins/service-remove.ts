import { NotFoundError } from '../../lib/domain-errors'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { removeIfUnderRoot } from '../ext/install-tree'
import { pluginInstallRoot, type DiscoveredPlugin } from './discovery'
import { setInPlaceRecord } from './in-place-installs'
import { uninstallRequiredBy } from './kit'
import type { PluginCatalogEntry } from './catalog'
import { factIdOf, factScopeOf, installedFacts } from './dependency-facts'
import { releaseCachedInstall } from './install-versioned'
import { removeDataIfLastCopy, rowScopeOf } from './service-lifecycle'
import { pluginIdOf } from './plugin-data-id'
import type { PluginService } from './service-types'

/**
 * `plugin remove`, kept out of `service.ts`. What goes depends on whose files the plugin is:
 * Localix's own copy is deleted (only strictly inside its install root); a plugin loading in place
 * from a local-folder marketplace loses its record and the folder stays, as it does in Claude
 * Code; a plugin Claude Code installed is only turned off here.
 */
export async function removePlugin(
  ctx: {
    repo: CapabilitySourceRepository
    home: string
    cwdFor: (userId: string, projectId: string) => Promise<string | null>
    discover: (scope: { cwd: string | null; projectId: string }) => Promise<DiscoveredPlugin[]>
    /** What is installed in the scope, with its on/off state (`buildPluginCatalog`). */
    entries: (projectId: string) => Promise<readonly PluginCatalogEntry[]>
    disable: (userId: string, name: string, projectId: string) => Promise<unknown>
    changed: (name: string, projectId: string) => void
    warn?: (message: string) => void
  },
  userId: string,
  input: { name: string; projectId?: string | null },
): ReturnType<PluginService['remove']> {
  const { repo, home } = ctx
  const projectId = input.projectId ?? ''
  const cwd = projectId ? await ctx.cwdFor(userId, projectId) : null
  const discovered = await ctx.discover({ cwd, projectId })
  const plugin =
    discovered.find((p) => p.manifest.name === input.name && p.projectId === projectId) ?? null
  // Nothing to remove used to answer like a removal, so `/plugin remove typo` said "Removed".
  let rowScope = rowScopeOf(plugin, projectId)
  if (!plugin && !(await repo.get(userId, projectId, input.name))) {
    // A user-scope plugin whose folder is gone keeps its row in the user scope alone.
    if (projectId && (await repo.get(userId, '', input.name))) rowScope = ''
    else throw new NotFoundError('plugin_not_found', `Plugin "${input.name}" is not installed`)
  }
  // Claude Code owns what it installed; Localix reads that folder in place. Turning the
  // plugin off here is the part that is ours to change.
  if (plugin?.claudeCodeInstall) {
    await ctx.disable(userId, input.name, projectId)
    return { warnings: [], claudeCodeInstall: plugin.claudeCodeInstall }
  }
  // NO cascade and no refusal on remove, as in Claude Code: the enabled plugins that still need it
  // (the kit's `requiredBy`) are named, and they then fail to load.
  const entries = await ctx.entries(projectId)
  const removed = plugin && entries.find((entry) => entry.plugin.dir === plugin.dir)
  const requiredBy = removed
    ? uninstallRequiredBy(factIdOf(removed), factScopeOf(removed.plugin), installedFacts(entries))
    : []
  // A plugin loading in place is uninstalled by dropping its record, also when its folder is gone.
  if (!plugin || plugin.scope === 'global')
    await setInPlaceRecord(pluginInstallRoot('global', null, home), input.name, null)
  await repo.remove(userId, rowScope, input.name)
  // An older build kept a user-scope plugin's options in a per-project row as well.
  if (rowScope !== projectId) await repo.remove(userId, projectId, input.name)
  // An in-place plugin's folder is the person's: it is not deleted. A cached version is orphaned,
  // so whatever started from it keeps its files for 14 days. Anything else (a project's recorded
  // copy too) only inside its root.
  const recorded = plugin?.cachedInstall
  if (recorded) await releaseCachedInstall(home, recorded.id, plugin.dir, recorded.projectPath)
  if (plugin && !plugin.inPlaceInstall && (!recorded || recorded.projectPath)) {
    await removeIfUnderRoot(plugin.dir, pluginInstallRoot(plugin.scope, cwd, home))
  }
  await removeDataIfLastCopy({
    userId,
    name: input.name,
    ...(plugin ? { id: pluginIdOf(plugin) } : {}),
    home,
    repo,
    discoverHome: () => ctx.discover({ cwd: null, projectId: '' }),
  })
  ctx.changed(input.name, projectId)
  if (requiredBy.length) {
    const warning = `"${input.name}" was removed — warning: required by ${requiredBy.join(', ')}`
    ctx.warn?.(warning)
    return { warnings: [warning] }
  }
  return undefined
}
