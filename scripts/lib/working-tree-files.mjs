import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The working tree's files, relative to `root`: tracked ones and new ones not yet added, minus the
 * ignored and the ones deleted but not yet committed. A check is useful before a contributor
 * stages a new file, and in CI the set collapses to the tracked files.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function workingTreeFiles(root) {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 << 20,
  })
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  return listed.stdout.split('\n').filter((file) => file && existsSync(join(root, file)))
}
