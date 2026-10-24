import { NotFoundError } from '../../lib/domain-errors'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { removeIfUnderRoot } from '../ext/install-tree'
import { listDependents } from './dependencies'
import { pluginInstallRoot, type DiscoveredPlugin } from './discovery'
import { setInPlaceRecord } from './in-place-installs'
import { assertNotBuiltin } from './builtin-plugins'
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
  assertNotBuiltin(plugin, 'uninstall')
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
  // NO cascade on remove — dependents keep working off their own state — but WARN
  // when other installed plugins still declare a dependency on the removed one.
  const dependents = listDependents(input.name, discovered)
  // A plugin loading in place is uninstalled by dropping its record, also when its folder is gone.
  if (!plugin || plugin.scope === 'global')
    await setInPlaceRecord(pluginInstallRoot('global', null, home), input.name, null)
  await repo.remove(userId, rowScope, input.name)
  // An older build kept a user-scope plugin's options in a per-project row as well.
  if (rowScope !== projectId) await repo.remove(userId, projectId, input.name)
  // An in-place plugin's folder is the person's: it is not deleted. A cached version is orphaned,
  // so whatever started from it keeps its files for 14 days. Anything else only inside its root.
  if (plugin?.cachedInstall) await releaseCachedInstall(home, plugin.cachedInstall.id, plugin.dir)
  else if (plugin && !plugin.inPlaceInstall) {
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
  if (dependents.length) {
    const warning = `"${input.name}" was removed, but other installed plugin(s) still depend on it: ${dependents.join(', ')}.`
    ctx.warn?.(warning)
    return { warnings: [warning] }
  }
  return undefined
}
