// Where Localix's bundled extensions live, named once for every build, staging, watch and guard
// script. The repository keeps the two layers apart (AGENTS.md, "Plugins and mini apps"): each
// folder under `mini-apps/` is one mini app, and each folder under `plugins/` is one Claude Code
// plugin built into Localix. A build stages the mini apps into one root beside the server bundle
// and the built-in plugins into another (`resources/builtin-plugins`), which the API reads at
// runtime. A Claude Code plugin is never staged as a mini app.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { hasExtensionManifest, isClaudeCodePluginOnly } from './extension-manifest.mjs'

/** The repository folder of the bundled mini apps, one folder each. */
export const MINI_APPS_DIR = 'mini-apps'

/** A repository-relative path inside a bundled mini app starts with this. */
export const MINI_APPS_PREFIX = `${MINI_APPS_DIR}/`

/** The repository folder of the bundled plugins that are not part of a mini app. */
export const PLUGINS_DIR = 'plugins'

/** Both bundled folders, mini apps first. */
export const BUNDLED_DIRS = [MINI_APPS_DIR, PLUGINS_DIR]

/** The folder a build stages every bundled extension into, beside `server.js` (`resources/<dir>`). */
export const STAGED_APPS_DIR = 'mini-apps'

/** The absolute folder of a checkout's bundled mini apps. */
export function miniAppsRoot(repoRoot) {
  return join(repoRoot, MINI_APPS_DIR)
}

/**
 * The absolute folders of a checkout's bundled extensions, mini apps first — the ones that exist:
 * a folder with nothing in it is not checked out (`plugins/` holds no plugin today).
 */
export function bundledRoots(repoRoot) {
  return BUNDLED_DIRS.map((dir) => join(repoRoot, dir)).filter((dir) => existsSync(dir))
}

/**
 * The folder of the bundled extension called `name`, in whichever bundled folder holds it, or null
 * when neither does. A mini app and a plugin never share a name; a folder without a manifest (the
 * ignored build caches a move leaves behind) is not one.
 */
export function bundledFolderOf(repoRoot, name) {
  for (const root of bundledRoots(repoRoot)) {
    const folder = join(root, name)
    if (hasExtensionManifest(folder) && !isClaudeCodePluginOnly(folder)) return folder
  }
  return null
}

/** The folder a build stages the built-in plugins into, beside `server.js` (`resources/<dir>`). */
export const STAGED_BUILTIN_PLUGINS_DIR = 'builtin-plugins'

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
