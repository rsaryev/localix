import { join, resolve } from 'node:path'

import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'

import { listSubdirs, pathExists } from '../ext/fs-discovery'
import { resolveBundledRoot } from '../../lib/bundled-root'
import { envString } from '../../lib/env'
import { syncBundledMiniApps } from './bundled-install'
import { type DiscoveredMiniApp, loadMiniApp } from './folder'

import { MINI_APPS_SUBDIR } from './paths'

export { MINI_APPS_SUBDIR }
export { type DiscoveredMiniApp, loadMiniApp }

/**
 * How a mini app is found and read (`paths.ts` says where). A mini app is Localix's own format
 * and shares nothing with a plugin (docs/internals/plugins-and-mini-apps.md): this module reads
 * `mini-app.json` and nothing of the Claude Code format, and the plugins feature never reads
 * these folders. A project's copy appears only under a name the user's own do not hold.
 */

/** Written beside a staged root by the build; a root without it is source, never synchronized. */
const BUNDLED_STAGING_MARKER = '.localix-staged.json'

/**
 * Where the mini apps Localix ships come from: the `LOCALIX_BUNDLED_MINI_APPS_DIR` override, else
 * the staged `mini-apps/` beside the server bundle, else the repository's `mini-apps/` when
 * running from source (`lib/bundled-root.ts`).
 */
export function bundledMiniAppsRoot(): string {
  return resolveBundledRoot({
    moduleUrl: import.meta.url,
    dirName: 'mini-apps',
    sourceRelative: '../../../../../mini-apps',
    override: envString('LOCALIX_BUNDLED_MINI_APPS_DIR'),
  })
}

/**
 * The root to synchronize from: one named explicitly (tests, the dev launcher), or a staged one.
 * The source tree fails this on purpose: its mini apps carry authoring files and workspace
 * imports and must never be copied into the user's root as they are.
 */
export async function bundledMiniAppsSyncRoot(): Promise<string | null> {
  const root = bundledMiniAppsRoot()
  if (envString('LOCALIX_BUNDLED_MINI_APPS_DIR')) return root
  return (await pathExists(join(root, BUNDLED_STAGING_MARKER))) ? root : null
}

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
 */
export async function discoverMiniApps(opts: {
  homeDir: string
  cwd?: string | null
  projectId?: string
  /** Synchronize the shipped mini apps into the user's root first (default true). */
  includeBundled?: boolean
}): Promise<DiscoveredMiniApp[]> {
  const projectId = opts.projectId ?? ''
  const absCwd = opts.cwd && opts.cwd !== '/' ? resolve(opts.cwd) : null
  const bundledRoot = (opts.includeBundled ?? true) ? await bundledMiniAppsSyncRoot() : null
  const bundled = bundledRoot
    ? await syncBundledMiniApps(bundledRoot, opts.homeDir)
    : new Set<string>()
  const [own, projects] = await Promise.all([
    scanRoot(join(opts.homeDir, MINI_APPS_SUBDIR), 'global', ''),
    projectId && absCwd && absCwd !== opts.homeDir
      ? scanRoot(join(absCwd, MINI_APPS_SUBDIR), 'project', projectId)
      : Promise.resolve([]),
  ])
  const mine = own.map((app) => ({ ...app, projectId, bundled: bundled.has(app.name) }))
  return byPrecedence([mine, projects])
}

/**
 * The mini apps in the shipped source root, read in place and sorted by name: what the build
 * stages, for the checks and generators that must see exactly that set whatever the user has.
 * One marked `private` (the authoring template) is left out.
 */
export async function discoverBundledMiniApps(): Promise<DiscoveredMiniApp[]> {
  const found = await scanRoot(bundledMiniAppsRoot(), 'global', '')
  return found
    .filter((app) => app.manifest?.private !== true)
    .map((app) => ({ ...app, bundled: true }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Where a new mini app of this scope is installed. */
export function miniAppInstallRoot(
  scope: 'global' | 'project',
  cwd: string | null | undefined,
  home: string,
): string {
  return join(scope === 'project' && cwd ? resolve(cwd) : home, MINI_APPS_SUBDIR)
}
