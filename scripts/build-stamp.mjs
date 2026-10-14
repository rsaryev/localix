// The identity a UI bundle reports as `__UI_BUILD__` (the startup log line that says which
// build is running).
//
// The stamp is resolved in three steps, and each one exists to stop a wrong stamp:
//
// 1. A caller that already knows the identity must win. Turbo hashes a task's declared `env`
//    but not git state, so a git-derived stamp computed inside a cached `vite build` is
//    replayed onto whatever commit next hits that cache entry. An explicit
//    `LOCALIX_BUILD_STAMP` (declared in `turbo.json`) is part of the hash, so a different
//    stamp is a different cache entry. The desktop staging script passes it for the same
//    reason: its own cache key and the bundle then carry one value instead of two copies that
//    can disagree.
// 2. Under Turbo without an explicit stamp, the task hash is the only honest identity: it is
//    exactly what a replay is keyed on, so a replayed bundle names the inputs it was built from.
// 3. Otherwise git names the commit, and `-dirty` marks uncommitted changes. The release
//    workflow writes the tag version into the files in `RELEASE_STAMPED_FILES` before it builds,
//    and cargo rewrites the lockfile's own version line to match; counting those made every
//    release bundle report `-dirty`, so they are excluded by name and nothing else is.

import { execFileSync } from 'node:child_process'

export const BUILD_STAMP_ENV = 'LOCALIX_BUILD_STAMP'

/** Files the release workflow (or cargo, following it) rewrites before building the UI. */
export const RELEASE_STAMPED_FILES = [
  'apps/desktop-tauri/src-tauri/tauri.conf.json',
  'apps/desktop-tauri/src-tauri/Cargo.toml',
  'apps/desktop-tauri/src-tauri/Cargo.lock',
]

const SAFE_STAMP = /^[A-Za-z0-9._-]{1,64}$/u

function runGit(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

/**
 * @param {{ cwd?: string, env?: Record<string, string | undefined>,
 *   git?: (args: string[], cwd?: string) => string }} [options]
 * @returns {string}
 */
export function resolveBuildStamp({ cwd, env = process.env, git = runGit } = {}) {
  const explicit = env[BUILD_STAMP_ENV]?.trim()
  if (explicit) {
    if (!SAFE_STAMP.test(explicit)) {
      throw new Error(`${BUILD_STAMP_ENV} must be 1-64 characters of [A-Za-z0-9._-]`)
    }
    return explicit
  }

  const turboHash = env.TURBO_HASH?.trim()
  if (turboHash) return `turbo-${turboHash.slice(0, 16)}`

  try {
    const commit = git(['rev-parse', '--short', 'HEAD'], cwd)
    // `:/` is the whole tree whatever `cwd` is; `top,exclude` names each stamped file from the
    // root, so the check means the same thing from `apps/ui` and from the desktop scripts.
    const changes = git(
      [
        'status',
        '--porcelain',
        '--',
        ':/',
        ...RELEASE_STAMPED_FILES.map((file) => `:(top,exclude)${file}`),
      ],
      cwd,
    )
    return `${commit}${changes ? '-dirty' : ''}`
  } catch {
    // No git (a source tarball, a detached build context): the bundle is still identifiable by
    // the app version, so this is a degraded stamp, not an error.
    return 'unknown'
  }
}
