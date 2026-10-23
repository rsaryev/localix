import { join, resolve } from 'node:path'

import { mergeByPrecedence, pathExists as _pathExists } from '../ext/fs-discovery'
import { normalizeCcToolName } from '../ext/cc-tool-names'

import type { DiscoveredPlugin } from './discovery-types'

import { scanDirsCached } from './discovery-cached-scan'

import { discoverClaudeCodePlugins } from './claude-code-installs'
import { discoverInPlacePlugins } from './in-place-installs'
import { builtinShadowNotes, discoverBuiltinPlugins } from './builtin-plugins'
import { discoverCachedPlugins } from './cached-installs'
export { findManifestPath } from './discovery-directory-scan'

/**
 * Filesystem plugin discovery. A plugin is a Claude Code plugin folder (its
 * `.claude-plugin/plugin.json`, or a default component location) under one of:
 *
 *   ~/.localix/plugins/<name>/      (sessions without a project)
 *   <project>/.localix/plugins/<name>/   (project-scoped)
 *
 * and, read in place, the plugins installed from a marketplace added from a local folder
 * (`in-place-installs.ts`) and the plugins installed and turned on in Claude Code
 * (`claude-code-installs.ts`). In project scopes, project copies take precedence over home
 * copies of the same name, home copies over in-place plugins, and Localix's own installs over
 * Claude Code's. Home plugins are projected into the requested projectId so their enable/config
 * state remains exact-scope.
 *
 * The plugins built into Localix (`builtin-plugins.ts`) come before all of them: a built-in plugin
 * holds its name like Claude Code's managed plugins, and every other copy of that name is reported
 * on it instead of loading. User-scope copies installed from a marketplace live in the version
 * cache and are read through their records (`cached-installs.ts`), right after the home folders.
 */

const PLUGIN_SUBDIRS = ['.localix/plugins']

export type { DiscoveredPlugin } from './discovery-types'

/** Return true if the path exists and is accessible, false otherwise. */
export const pathExists = _pathExists

// Re-export so importers (loader-contract.ts, run/permission-gate-build.ts) that depend on this
// module's path continue to work without import-path changes.
export { normalizeCcToolName }

// Manifest parsing (loadManifest) lives in manifest-load.ts. Re-exported here so
// the historical `./discovery` import surface stays stable for service.ts, the
// loader, and the discovery/validate tests. (parseInlineCommands/readSkillNames
// are loadManifest internals — not re-exported, no external consumer.)
export { loadManifest } from './manifest-load'

/** Discover the plugins visible to a scope. */
export async function discoverPlugins(opts: {
  cwd?: string | null
  projectId?: string
  /**
   * The user's home: source of the global `.localix/plugins` scan. REQUIRED, decided once at the composition root (`os.homedir()`), a fixture in a test.
   * It had a silent `homedir()` default, and Bun reads the home once per process — so a test that
   * reassigned `HOME`, or passed nothing, staged its fixture plugins into the real
   * `~/.localix/plugins` and read the developer's own installed plugins back.
   */
  homeDir: string
}): Promise<DiscoveredPlugin[]> {
  const home = opts.homeDir
  const projectId = opts.projectId ?? ''
  const absCwd = opts.cwd && opts.cwd !== '/' ? resolve(opts.cwd) : null

  const projectScan =
    absCwd && absCwd !== home
      ? scanDirsCached(absCwd, PLUGIN_SUBDIRS, 'project', projectId)
      : Promise.resolve([])
  const homeScan = scanDirsCached(home, PLUGIN_SUBDIRS, 'global', '')
  const builtinScan = discoverBuiltinPlugins(projectId)
  // Uncached on purpose, like the in-place ones: an update swaps the record, not a folder.
  const cachedScan = discoverCachedPlugins({ homeDir: home, projectId })
  // Uncached on purpose: an edit in the folder loads at the next `/plugin reload`.
  const inPlaceScan = discoverInPlacePlugins({ homeDir: home, projectId })
  const claudeCodeScan = discoverClaudeCodePlugins({
    homeDir: home,
    cwd: projectId ? absCwd : null,
    projectId,
  })
  const [builtins, projectPlugins, homePlugins, cachedPlugins, inPlacePlugins, claudeCodePlugins] =
    await Promise.all([builtinScan, projectScan, homeScan, cachedScan, inPlaceScan, claudeCodeScan])
  if (!projectId) {
    const installed = [homePlugins, cachedPlugins, inPlacePlugins, claudeCodePlugins]
    return mergeByPrecedence([builtinShadowNotes(builtins, installed), ...installed])
  }

  // EVERYTHING the user has, plus the repository's own plugins.
  //
  // Home plugins used to belong to project-less sessions alone — open a project and your own
  // installed plugins were simply gone, with nothing saying so. What a plugin may DO is a rule on
  // the agent, and an unvetted one is not imported until you allow it.
  //
  // The user's own plugins come FIRST. That rule is keyed by the manifest name alone, and a
  // repository picks its own manifest name: a project copy that shadowed your plugin of the same
  // name would inherit the `plugin:<name> * allow` you gave yours and run its code with nobody
  // having said yes to it. So a project copy only appears under a name nothing of yours holds.
  //
  // The state key still follows the active project: a plugin's config and its rules belong to
  // where it is used, which is what keeps two projects from sharing one plugin's settings.
  const homeForProject = homePlugins.map((plugin) => ({ ...plugin, projectId }))
  const installed = [
    homeForProject,
    cachedPlugins,
    inPlacePlugins,
    claudeCodePlugins,
    projectPlugins,
  ]
  return mergeByPrecedence([builtinShadowNotes(builtins, installed), ...installed])
}

/** The canonical install directory for a scope (global home, or a project dir). */
export function pluginInstallRoot(
  scope: 'global' | 'project',
  cwd: string | null | undefined,
  home: string,
): string {
  const base = scope === 'project' && cwd ? resolve(cwd) : home
  return join(base, '.localix/plugins')
}
