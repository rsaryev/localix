/**
 * What the native watcher skips, as globs relative to the watched root.
 *
 * The rule is that the watcher may only stay blind to what the TREE never shows changing. The
 * previous list dropped every event under `dist`, `build`, `target`, `.localix` and friends — yet
 * the tree lists those folders like any other, so a plan written to `.localix/plans/…`, a fresh
 * build output or even the creation of such a folder in the root never reached the screen until
 * a manual Refresh. So nothing a person browses is excluded any more; churn there is bounded by
 * the watcher's debounce and its coarse-reload cap instead.
 *
 * What remains is the version-control internals (git's object store and subtree cache,
 * Mercurial's store) plus the INSIDE of each installed package. Those are the trees whose
 * size is the cost: an inotify backend adds a kernel watch per directory, and a dependency tree
 * is tens of thousands of them (ENOSPC). Each glob excludes the CONTENTS (`/**`), never the folder
 * itself, so `node_modules/<pkg>` appearing or disappearing still refreshes `node_modules`.
 */
export const WATCH_IGNORE_GLOBS: readonly string[] = [
  '**/.git/objects/**',
  '**/.git/subtree-cache/**',
  '**/.hg/store/**',
  '**/node_modules/*/**',
]
