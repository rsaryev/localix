// Where Localix's bundled extensions live, named once for every build, staging, watch and guard
// script. The repository keeps the two layers apart (AGENTS.md, "Plugins and mini apps"): each
// folder under `mini-apps/` is one mini app (its screens, backend and tools, with the plugin it
// contains), and each folder under `plugins/` is one plugin with no mini app. A build stages both
// into one root beside the server bundle, which the API reads at runtime.
import { join } from 'node:path'
import { hasExtensionManifest } from './extension-manifest.mjs'

/** The repository folder of the bundled mini apps, one folder each. */
export const MINI_APPS_DIR = 'mini-apps'

/** A repository-relative path inside a bundled mini app starts with this. */
export const MINI_APPS_PREFIX = `${MINI_APPS_DIR}/`

/** The repository folder of the bundled plugins that are not part of a mini app. */
export const PLUGINS_DIR = 'plugins'

/** Both bundled folders, mini apps first. */
export const BUNDLED_DIRS = [MINI_APPS_DIR, PLUGINS_DIR]

/** The folder a build stages every bundled extension into, beside `server.js` (`resources/<dir>`). */
export const STAGED_APPS_DIR = 'plugins'

/** The absolute folder of a checkout's bundled mini apps. */
export function miniAppsRoot(repoRoot) {
  return join(repoRoot, MINI_APPS_DIR)
}

/** The absolute folders of a checkout's bundled extensions, mini apps first. */
export function bundledRoots(repoRoot) {
  return BUNDLED_DIRS.map((dir) => join(repoRoot, dir))
}

/**
 * The folder of the bundled extension called `name`, in whichever bundled folder holds it, or null
 * when neither does. A mini app and a plugin never share a name; a folder without a manifest (the
 * ignored build caches a move leaves behind) is not one.
 */
export function bundledFolderOf(repoRoot, name) {
  for (const root of bundledRoots(repoRoot)) {
    if (hasExtensionManifest(join(root, name))) return join(root, name)
  }
  return null
}

const segmentsOf = (rel) => String(rel).split(/[\\/]/u)

/**
 * The bundled extension a repository-relative path lies in, mini app or plugin:
 * `plugins/workflows/commands/workflows.md` is `{ dir: 'plugins', app: 'workflows', rest: … }`.
 * Null outside the bundled folders and for a folder's own files (`mini-apps/README.md`).
 * @param {string} rel
 * @returns {{ dir: string, app: string, rest: string } | null}
 */
export function extensionOfPath(rel) {
  const [dir, app, ...rest] = segmentsOf(rel)
  if (!BUNDLED_DIRS.includes(dir) || !app || rest.length === 0) return null
  return { dir, app, rest: rest.join('/') }
}

/**
 * The bundled mini app a repository-relative path lies in: `mini-apps/chess/ui/App.tsx` is
 * `{ app: 'chess', rest: 'ui/App.tsx' }`. Null for a bundled plugin, outside `mini-apps/` and for
 * the folder's own files. `rest` is `''` for the folder itself written with a trailing slash.
 * @param {string} rel
 * @returns {{ app: string, rest: string } | null}
 */
export function appOfPath(rel) {
  const found = extensionOfPath(rel)
  return found?.dir === MINI_APPS_DIR ? { app: found.app, rest: found.rest } : null
}
