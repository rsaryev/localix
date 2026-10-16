import { join } from 'node:path'
import { listSubdirs, pathExists } from '../ext/fs-discovery'
import { isExtensionPublicationArtifact } from '../ext/publish-tree'
import { locateManifest, PLUGIN_MANIFEST_CANDIDATES } from './manifest-locate'
import { loadManifest } from './manifest-load'
import type { DiscoveredPlugin } from './discovery-types'

/**
 * Locate a plugin's native manifest (`plugin.json` at the plugin root), or null.
 * Foreign layouts are converted at install time and at startup by the importer.
 */
export async function findManifestPath(dir: string): Promise<string | null> {
  return locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)
}

/** Default component locations that make a manifest-less directory a valid plugin. */
const PLUGIN_COMPONENT_PATHS = ['skills', 'commands', 'agents', '.mcp.json', 'tools']

/**
 * Is `dir` a plugin? True when it has a root manifest OR — the manifest is optional —
 * at least one recognized
 * component directory/file (skills/commands/agents/tools/.mcp.json). Bare dirs (e.g. a
 * `cache`) are skipped. An LSP-only directory (just `.lsp.json`) does not qualify
 * through this component-based fallback.
 */
async function isPluginDir(dir: string): Promise<boolean> {
  if (await findManifestPath(dir)) return true
  // Check all component paths in parallel — any one present makes this a plugin.
  const checks = await Promise.all(PLUGIN_COMPONENT_PATHS.map((c) => pathExists(join(dir, c))))
  return checks.some(Boolean)
}

/**
 * Atomic bundled-plugin installs briefly place complete plugin trees beside the
 * canonical install directory. They are transaction artifacts, never discovery
 * roots: loading one races its rename/removal and can replace a healthy plugin
 * with an entry whose native backend disappears before it is imported.
 */
function isPluginSyncArtifact(name: string): boolean {
  return name.startsWith('.sync-') || isExtensionPublicationArtifact(name)
}

/**
 * Generic plugin directory scanner. Iterates `subdirs` under `baseDir` (pass `''` to
 * scan `baseDir` itself), calls `isPluginDir` (manifest or component dirs), and loads
 * each.
 */
export async function scanDirs(
  baseDir: string,
  subdirs: string[],
  scope: 'project' | 'global',
  projectId: string,
  opts?: {
    bundled?: boolean
    bundledNames?: ReadonlySet<string>
  },
): Promise<DiscoveredPlugin[]> {
  // All subdirs are independent — scan them in parallel.
  const batches = await Promise.all(
    subdirs.map(async (sub) => {
      const root = sub ? join(baseDir, sub) : baseDir
      const names = (await listSubdirs(root)).filter((name) => !isPluginSyncArtifact(name))
      const candidates = await Promise.all(
        names.map(async (name) => {
          const dir = join(root, name)
          const valid = await isPluginDir(dir)
          return valid
            ? loadManifest(dir, scope, projectId, opts?.bundled ?? opts?.bundledNames?.has(name))
            : null
        }),
      )
      return candidates.filter(
        (plugin): plugin is DiscoveredPlugin =>
          plugin !== null && !(opts?.bundled && plugin.manifest.private === true),
      )
    }),
  )
  return batches.flat()
}
