import { join, resolve } from 'node:path'

import { mergeByPrecedence, pathExists as _pathExists } from '../ext/fs-discovery'
import { normalizeCcToolName } from '../ext/cc-tool-names'
import { resolveBundledRoot } from '../../lib/bundled-root'
import { envString } from '../../lib/env'

import type { DiscoveredPlugin } from './discovery-types'
import { syncBundledPlugins } from './bundled-install'

import { scanDirsCached } from './discovery-cached-scan'

import { scanDirs } from './discovery-directory-scan'
import { discoverClaudeCodePlugins } from './claude-code-installs'
import { discoverInPlacePlugins } from './in-place-installs'
export { findManifestPath } from './discovery-directory-scan'

// Re-export so importers (loader.ts, discovery.test.ts) keep their existing
// `./discovery` surface for entrypoint resolution.

/**
 * Filesystem plugin discovery. A plugin is a directory with a `plugin.json`
 * manifest under one of:
 *
 *   ~/.localix/plugins/<name>/      (sessions without a project)
 *   <project>/.localix/plugins/<name>/   (project-scoped)
 *
 * and, read in place, the plugins installed from a marketplace added from a local folder
 * (`in-place-installs.ts`) and the plugins installed and turned on in Claude Code
 * (`claude-code-installs.ts`). In project scopes, project copies take precedence over home
 * copies of the same name, home copies over in-place plugins, and Localix's own installs over
 * Claude Code's. Home plugins are
 * projected into the requested projectId so their enable/config state remains exact-scope. Managed first-party artifacts are synchronized into
 * the home root before discovery, while their code remains shared across scopes.
 */

const PLUGIN_SUBDIRS = ['.localix/plugins']
const BUNDLED_STAGING_MARKER = '.localix-staged.json'

/**
 * Repo/packaged first-party plugin SOURCE root. Normal runtime discovery never
 * executes it directly: artifacts are synchronized into `~/.localix/plugins`
 * first. It also doubles as the authoring/marketplace source. SELF-LOCATED from this
 * module's own URL (see `lib/bundled-root.ts` for the rule): the
 * LOCALIX_BUNDLED_PLUGINS_DIR override, else a staged `plugins/` sibling of this
 * module (the BUNDLED layout), else the repo root `plugins/` five levels up
 * (plugins → features → src → api → apps → root) when running from source.
 */
export function bundledPluginsRoot(): string {
  return resolveBundledRoot({
    moduleUrl: import.meta.url,
    dirName: 'plugins',
    sourceRelative: '../../../../../plugins',
    override: envString('LOCALIX_BUNDLED_PLUGINS_DIR'),
  })
}

/**
 * Runtime synchronization accepts either an explicitly supplied root (tests and
 * launchers own that trust decision) or a self-located packaged root carrying the
 * staging marker. The source-tree fallback intentionally fails this check: raw
 * repo plugins contain authoring files and unresolved TS/workspace imports and
 * must never be copied into the user's global install root.
 *
 * `discoverBundledPlugins()` deliberately does not use this gate — marketplace
 * generation and validation still inspect the raw authoring tree in-place.
 */
export async function bundledPluginsSyncRoot(): Promise<string | null> {
  const explicit = envString('LOCALIX_BUNDLED_PLUGINS_DIR')
  const root = bundledPluginsRoot()
  if (explicit || (await pathExists(join(root, BUNDLED_STAGING_MARKER)))) return root
  return null
}

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

/**
 * Discover plugins visible to a scope. Explicit or staged first-party artifacts
 * are synchronized into `~/.localix/plugins` first; an unmarked source-tree
 * fallback is authoring input only and is never copied. Discovery itself then
 * reads only project/global `.localix/plugins` roots.
 */
export async function discoverPlugins(opts: {
  cwd?: string | null
  projectId?: string
  includeBundled?: boolean
  /**
   * The user's home: source of the global `.localix/plugins` scan and where bundled plugins are
   * staged. REQUIRED, decided once at the composition root (`os.homedir()`), a fixture in a test.
   * It had a silent `homedir()` default, and Bun reads the home once per process — so a test that
   * reassigned `HOME`, or passed nothing, staged its fixture plugins into the real
   * `~/.localix/plugins` and read the developer's own installed plugins back.
   */
  homeDir: string
}): Promise<DiscoveredPlugin[]> {
  const home = opts.homeDir
  const projectId = opts.projectId ?? ''
  const includeBundled = opts.includeBundled ?? true
  const absCwd = opts.cwd && opts.cwd !== '/' ? resolve(opts.cwd) : null
  const bundledRoot = includeBundled ? await bundledPluginsSyncRoot() : null
  const bundledNames = bundledRoot ? await syncBundledPlugins(bundledRoot, home) : new Set<string>()

  const projectScan =
    absCwd && absCwd !== home
      ? scanDirsCached(absCwd, PLUGIN_SUBDIRS, 'project', projectId)
      : Promise.resolve([])
  const homeScan = scanDirsCached(home, PLUGIN_SUBDIRS, 'global', '', { bundledNames })
  // Uncached on purpose: an edit in the folder loads at the next `/plugin reload`.
  const inPlaceScan = discoverInPlacePlugins({ homeDir: home, projectId })
  const claudeCodeScan = discoverClaudeCodePlugins({
    homeDir: home,
    cwd: projectId ? absCwd : null,
    projectId,
  })
  const [projectPlugins, homePlugins, inPlacePlugins, claudeCodePlugins] = await Promise.all([
    projectScan,
    homeScan,
    inPlaceScan,
    claudeCodeScan,
  ])
  if (!projectId) return mergeByPrecedence([homePlugins, inPlacePlugins, claudeCodePlugins])

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
  return mergeByPrecedence([homeForProject, inPlacePlugins, claudeCodePlugins, projectPlugins])
}

/**
 * Inspect ONLY first-party source plugins (`plugins/`), in isolation from whatever
 * the developer has installed. {@link discoverPlugins} merges project/global
 * plugins AHEAD of bundled and dedupes by name (first-wins), so a developer who installed a plugin
 * sharing a bundled name shadows its managed copy.
 * The bundled-marketplace generator (`scripts/generate-bundled-marketplace.ts`) and its
 * drift-guard test must see the TRUE bundled set regardless of local installs, so both use
 * this hermetic single-source scan rather than filtering a full merged discovery.
 *
 * Authoring-only source plugins declare `private: true` in their own manifest. Staged builds
 * physically exclude them, while this in-repo scan filters them after generic manifest loading.
 * A copy under ~/.localix/plugins is a normal user installation — the filter is bundled-only.
 *
 * Sorted by name so callers (the marketplace generator writes a committed file) get a
 * deterministic order — `scanDirs` returns in filesystem `readdir` order, which varies
 * across machines and would otherwise churn the generated catalog. `discoverPlugins`
 * applies the same sort via `mergeByPrecedence`.
 */
export async function discoverBundledPlugins(): Promise<DiscoveredPlugin[]> {
  const found = await scanDirs(bundledPluginsRoot(), [''], 'global', '', {
    bundled: true,
  })
  return found.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
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
