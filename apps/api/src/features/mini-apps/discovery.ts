import { join, resolve } from 'node:path'

import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

import { listSubdirs, pathExists } from '../ext/fs-discovery'
import { type DiscoveredMiniApp, loadMiniApp } from './folder'
import { pruneRetiredManagedCopies } from './managed-copy'
import { MINI_APPS_SUBDIR } from './paths'

export { MINI_APPS_SUBDIR }
export { type DiscoveredMiniApp, loadMiniApp }

/**
 * How a mini app is found and read (`paths.ts` says where). A mini app is Localix's own format
 * and shares nothing with a plugin (docs/internals/plugins-and-mini-apps.md): this module reads
 * `mini-app.json` and nothing of the Claude Code format, and the plugins feature never reads
 * these folders. A project's copy appears only under a name the user's own do not hold.
 */

/** Install roots whose retired copies this process already swept. */
const prunedRoots = new Set<string>()

async function scanRoot(
  root: string,
  scope: 'global' | 'project',
  projectId: string,
): Promise<DiscoveredMiniApp[]> {
  const folders = await listSubdirs(root)
  const found = await Promise.all(
    folders
      .filter((name) => !name.startsWith('.'))
      .map(async (name) => {
        const dir = join(root, name)
        return (await pathExists(join(dir, MINI_APP_MANIFEST_FILE)))
          ? loadMiniApp(dir, scope, projectId)
          : null
      }),
  )
  return found.filter((entry): entry is DiscoveredMiniApp => entry !== null)
}

/** First one of a name wins, sorted by name. */
function byPrecedence(batches: DiscoveredMiniApp[][]): DiscoveredMiniApp[] {
  const byName = new Map<string, DiscoveredMiniApp>()
  for (const app of batches.flat()) if (!byName.has(app.name)) byName.set(app.name, app)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The mini apps visible to one scope. The user's own come first: a project picks its own
 * names, and a project copy that shadowed one of the user's would inherit the yes given to it.
 * The first discovery of a process also sweeps the copies earlier installs and updates retired
 * (`managed-copy.ts`), before anything from them is imported.
 */
export async function discoverMiniApps(opts: {
  homeDir: string
  cwd?: string | null
  projectId?: string
}): Promise<DiscoveredMiniApp[]> {
  const projectId = opts.projectId ?? ''
  const absCwd = opts.cwd && opts.cwd !== '/' ? resolve(opts.cwd) : null
  const installRoot = join(opts.homeDir, MINI_APPS_SUBDIR)
  if (!prunedRoots.has(installRoot)) {
    prunedRoots.add(installRoot)
    await pruneRetiredManagedCopies(installRoot)
  }
  const [own, projects] = await Promise.all([
    scanRoot(installRoot, 'global', ''),
    projectId && absCwd && absCwd !== opts.homeDir
      ? scanRoot(join(absCwd, MINI_APPS_SUBDIR), 'project', projectId)
      : Promise.resolve([]),
  ])
  const mine = own.map((app) => ({ ...app, projectId }))
  return byPrecedence([mine, projects])
}

/** Where a new mini app of this scope is installed. */
export function miniAppInstallRoot(
  scope: 'global' | 'project',
  cwd: string | null | undefined,
  home: string,
): string {
  return join(scope === 'project' && cwd ? resolve(cwd) : home, MINI_APPS_SUBDIR)
}
