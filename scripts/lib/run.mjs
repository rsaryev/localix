import { spawnSync } from 'node:child_process'

import { repoRoot } from './paths.mjs'

/**
 * Run a command to completion from the repository root. A command that could not be started
 * throws; a non-zero exit is returned for the caller to judge.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot(), encoding: 'utf8', ...options })
  if (result.error) throw result.error
  return result
}

/** {@link run}, ending this process with the command's status when it fails. */
export function runOrExit(command, args, options = {}) {
  const result = run(command, args, options)
  if (result.status !== 0) process.exit(result.status ?? 1)
  return result
}
