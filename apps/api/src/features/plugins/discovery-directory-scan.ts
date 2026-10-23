import { join } from 'node:path'
import { listSubdirs, pathExists } from '../ext/fs-discovery'
import { isExtensionPublicationArtifact } from '../ext/publish-tree'
import { COMPONENT_MARKERS } from '@localixai/claude-plugin'
import { MINI_APP_FILE } from './layout/read'
import { locateManifest, PLUGIN_MANIFEST_CANDIDATES } from './manifest-locate'
import { loadManifest } from './manifest-load'
import { withWorkflowCommands } from './workflow-commands'
import type { DiscoveredPlugin } from './discovery-types'

/** Locate a plugin's manifest (`.claude-plugin/plugin.json`), or null. */
export async function findManifestPath(dir: string): Promise<string | null> {
  return locateManifest(dir, PLUGIN_MANIFEST_CANDIDATES)
}

/**
 * What makes a directory a plugin, as in Claude Code: its manifest or a default component location
 * (the manifest is optional). A `mini-app.json` is read too, only so that a mini app dropped among
 * the plugins says what it is instead of vanishing. Bare dirs (e.g. a `cache`) are skipped.
 */
const PLUGIN_MARKERS = [...COMPONENT_MARKERS, MINI_APP_FILE]

async function isPluginDir(dir: string): Promise<boolean> {
  // Check all markers in parallel — any one present makes this a folder to read.
  const checks = await Promise.all(PLUGIN_MARKERS.map((c) => pathExists(join(dir, c))))
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
              withWorkflowCommands(await loadManifest(dir, scope, projectId))
            : null
        }),
      )
      return candidates.filter((plugin): plugin is DiscoveredPlugin => plugin !== null)
    }),
  )
  return batches.flat()
}
