// Where Localix's bundled extensions live, named once for every build, staging, watch and guard
// script. Each folder under the repository's bundled root is one extension (a mini app with its
// plugin, docs/internals/plugins-and-mini-apps.md); a build stages them into a sibling of the
// server bundle under the staged root, which the API's `bundledPluginsRoot()` reads.
//
// Renaming the folder (`plugins/` → `miniapps/`) changes these constants and the API's bundled
// root, and nothing else in the scripts.
import { join } from 'node:path'

/** The repository folder that holds the bundled extensions, one folder each. */
export const BUNDLED_APPS_DIR = 'plugins'

/** A repository-relative path below the bundled root starts with this. */
export const BUNDLED_APPS_PREFIX = `${BUNDLED_APPS_DIR}/`

/** The folder a build stages them into, beside `server.js` (`resources/<dir>`). */
export const STAGED_APPS_DIR = 'plugins'

/** The folder a contained plugin sits in inside its app (`<app>/plugins/<plugin>/`). */
const CONTAINED_PLUGINS_DIR = 'plugins'

/** The absolute bundled root of a checkout. */
export function bundledAppsRoot(repoRoot) {
  return join(repoRoot, BUNDLED_APPS_DIR)
}

const segmentsOf = (rel) => String(rel).split(/[\\/]/u)

/**
 * The bundled extension a repository-relative path lies in: `plugins/chess/ui/App.tsx` is
 * `{ app: 'chess', rest: 'ui/App.tsx' }`. Null outside the bundled root and for the root's own
 * files (`plugins/README.md`), which belong to no extension. `rest` is `''` for the folder itself
 * written with a trailing slash.
 * @param {string} rel
 * @returns {{ app: string, rest: string } | null}
 */
export function appOfPath(rel) {
  const [root, app, ...rest] = segmentsOf(rel)
  if (root !== BUNDLED_APPS_DIR || !app || rest.length === 0) return null
  return { app, rest: rest.join('/') }
}

/**
 * The contained plugin a repository-relative path lies in: `<root>/<app>/plugins/<plugin>/…` is
 * `{ app, plugin, rest }`. Null anywhere else, which today is every path: no bundled extension
 * holds its plugin in a `plugins/` subfolder yet.
 * @param {string} rel
 * @returns {{ app: string, plugin: string, rest: string } | null}
 */
export function pluginOfPath(rel) {
  const owner = appOfPath(rel)
  if (!owner) return null
  const [folder, plugin, ...rest] = segmentsOf(owner.rest)
  if (folder !== CONTAINED_PLUGINS_DIR || !plugin || rest.length === 0) return null
  return { app: owner.app, plugin, rest: rest.join('/') }
}
