/**
 * Which on-disk changes can move the map — shared by the walk that indexes the project and the tab
 * that decides whether a change it heard is worth a refresh.
 *
 * One list for both: the tab hears every change under the chat's workspace, `.git` and
 * `node_modules` included, and a tab that re-indexed on a `git status` touching `.git/index` or an
 * install churning dependencies would re-walk the project for nothing. Two copies of the list
 * would drift, and the drift would show up as either missed edits or wasted walks.
 */

/**
 * Never descended into, with or without a `.gitignore`: dependency trees, build output and tool
 * state. A project without git still has a `node_modules`, and walking it would index the world.
 */
export const ALWAYS_SKIPPED: ReadonlySet<string> = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.tox',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.localix',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
])

/**
 * Whether a batch of changed absolute paths can affect the map of the project at `root`. Coarse
 * (`null`) always can. A path outside `root` — a symlinked project whose watcher reports the
 * other spelling — is kept, because missing an edit is worse than one extra refresh.
 */
export function touchesProject(root: string, paths: readonly string[] | null): boolean {
  if (paths === null) return true
  // The watcher speaks the platform's separator; compare in one.
  const posix = (value: string) => value.replaceAll('\\', '/')
  const top = posix(root)
  const prefix = top.endsWith('/') ? top : `${top}/`
  return paths.map(posix).some((path) => {
    if (path === top) return true
    if (!path.startsWith(prefix)) return true
    return !path
      .slice(prefix.length)
      .split('/')
      .some((segment) => ALWAYS_SKIPPED.has(segment))
  })
}
