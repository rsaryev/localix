import { join } from 'node:path'
import { listSubdirs, pathExists } from '../ext/fs-discovery'
import { isExtensionPublicationArtifact } from '../ext/publish-tree'
import { COMPONENT_MARKERS } from '@localixai/claude-plugin'
import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import { LEGACY_MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/legacy-manifest'
import { locateManifest, PLUGIN_MANIFEST_CANDIDATES } from './manifest-locate'
import { loadManifest } from './manifest-load'
import { withWorkflowCommands } from './workflow-commands'
import type { DiscoveredPlugin } from './discovery-types'

/** Locate a plugin's manifest (`.claude-plugin/plugin.json`, else a legacy `plugin.json`), or null. */
export async function findManifestPath(dir: string): Promise<string | null> {
  return locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)
}

/**
 * What makes a directory an extension: a mini app manifest, a legacy `plugin.json`, or what makes
 * one a Claude Code plugin — its manifest or a default component location (the manifest is
 * optional). A legacy `tools/` entrypoint counts too. Bare dirs (e.g. a `cache`) are skipped.
 */
const EXTENSION_MARKERS = [
  MINI_APP_MANIFEST_FILE,
  ...COMPONENT_MARKERS,
  LEGACY_MINI_APP_MANIFEST_FILE,
  'plugin.json',
  'tools',
]

async function isPluginDir(dir: string): Promise<boolean> {
  // Check all markers in parallel — any one present makes this an extension.
  const checks = await Promise.all(EXTENSION_MARKERS.map((c) => pathExists(join(dir, c))))
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
            ? // A plugin's workflows run as its commands (`workflow-commands.ts`).
              withWorkflowCommands(
                await loadManifest(
                  dir,
                  scope,
                  projectId,
                  opts?.bundled ?? opts?.bundledNames?.has(name),
                ),
              )
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
