import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { errorMessage } from '../../lib/errors'
import { childEnvNonInteractive } from '../../lib/login-shell-env'
import { isRecord } from '../../lib/record'

const execFileAsync = promisify(execFile)

/**
 * A copied plugin's Node.js packages, installed as Claude Code installs them (loading.md, "Node.js
 * package dependencies"): only with a `package.json` and a lockfile at the plugin's root —
 * `bun.lock` (Bun), then `npm-shrinkwrap.json` or `package-lock.json` (npm, lockfileVersion 2 or
 * 3). Every dependency must be a registry package pinned to an exact version over `https` (or the
 * user's own registry), `package.json` and the lockfile must list the same dependencies, and npm
 * `overrides` or Bun `patchedDependencies` stop it. The package manager runs with scripts off, for
 * at most 60 seconds, in a folder holding only those two files (so the plugin's `.npmrc`, `.env`
 * and `bunfig.toml` are never read), and its `node_modules` then moves into the plugin.
 */

export type PackageManagerRun = (command: string, args: string[], cwd: string) => Promise<void>

const TIMEOUT_MS = 60_000

const defaultRun: PackageManagerRun = async (command, args, cwd) => {
  await execFileAsync(command, args, {
    cwd,
    timeout: TIMEOUT_MS,
    env: childEnvNonInteractive(),
    windowsHide: true,
  })
}

async function readText(file: string): Promise<string | undefined> {
  return fs.readFile(file, 'utf8').catch(() => undefined)
}

const sameKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort())

const EXACT = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/

function declared(pkg: Record<string, unknown>): Record<string, unknown> {
  return {
    ...(isRecord(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isRecord(pkg.optionalDependencies) ? pkg.optionalDependencies : {}),
  }
}

/** Why an npm lockfile gets no install, or undefined when it may install. */
function npmLockProblem(
  lock: Record<string, unknown>,
  pkg: Record<string, unknown>,
  defaultRegistry: string,
): string | undefined {
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3)
    return 'its npm lockfile needs lockfileVersion 2 or 3'
  if (pkg.overrides !== undefined) return 'its package.json sets npm overrides'
  const packages = isRecord(lock.packages) ? lock.packages : {}
  const root = isRecord(packages['']) ? packages[''] : {}
  if (!sameKeys(declared(pkg), declared(root as Record<string, unknown>)))
    return 'its package.json and lockfile do not list the same dependencies'
  for (const [path, entry] of Object.entries(packages)) {
    if (path === '' || !isRecord(entry)) continue
    if (entry.link === true) return `${path} is a linked or workspace package`
    const resolved = typeof entry.resolved === 'string' ? entry.resolved : ''
    if (typeof entry.version !== 'string' || !EXACT.test(entry.version))
      return `${path} is not pinned to an exact version`
    const onDefault = resolved.startsWith(defaultRegistry.replace(/\/+$/, ''))
    if (!resolved.startsWith('https://') && !onDefault)
      return `${path} is not a registry package downloaded over https`
  }
  return undefined
}

/** Why a bun.lock gets no install, or undefined when it may install. */
function bunLockProblem(lock: Record<string, unknown>, pkg: Record<string, unknown>) {
  if (typeof lock.lockfileVersion !== 'number' || lock.lockfileVersion > 2)
    return 'its bun.lock needs lockfileVersion 2 or lower'
  if (pkg.patchedDependencies !== undefined) return 'its package.json sets patchedDependencies'
  const workspaces = isRecord(lock.workspaces) ? lock.workspaces : {}
  const root = isRecord(workspaces['']) ? workspaces[''] : {}
  if (!sameKeys(declared(pkg), declared(root as Record<string, unknown>)))
    return 'its package.json and lockfile do not list the same dependencies'
  for (const [name, entry] of Object.entries(isRecord(lock.packages) ? lock.packages : {})) {
    const spec = Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : ''
    const version = spec.slice(spec.lastIndexOf('@') + 1)
    if (!EXACT.test(version)) return `${name} is not a registry package pinned to an exact version`
  }
  return undefined
}

export interface NodeDependencyResult {
  installed: boolean
  /** Why the install did not run, or failed, in words for the plugin's notes. */
  skipped?: string
}

export async function installNodeDependencies(
  pluginDir: string,
  opts: { run?: PackageManagerRun; defaultRegistry?: string } = {},
): Promise<NodeDependencyResult> {
  const pkgText = await readText(join(pluginDir, 'package.json'))
  if (pkgText === undefined) return { installed: false }
  const skip = (reason: string): NodeDependencyResult => ({
    installed: false,
    skipped: `Node.js packages were not installed: ${reason}`,
  })
  let pkg: Record<string, unknown>
  try {
    const parsed = JSON.parse(pkgText) as unknown
    if (!isRecord(parsed)) return skip('its package.json is not an object')
    pkg = parsed
  } catch {
    return skip('its package.json is not JSON')
  }
  const lockfiles = ['bun.lock', 'npm-shrinkwrap.json', 'package-lock.json']
  let lockName: string | undefined
  let lockText: string | undefined
  for (const name of lockfiles) {
    lockText = await readText(join(pluginDir, name))
    if (lockText !== undefined) {
      lockName = name
      break
    }
  }
  if (!lockName || lockText === undefined) {
    for (const other of ['bun.lockb', 'yarn.lock', 'pnpm-lock.yaml'])
      if ((await readText(join(pluginDir, other))) !== undefined)
        return skip(`${other} cannot be checked; ship bun.lock or an npm lockfile`)
    return { installed: false }
  }
  let lock: Record<string, unknown>
  try {
    const parsed = (
      lockName === 'bun.lock' ? Bun.JSONC.parse(lockText) : JSON.parse(lockText)
    ) as unknown
    if (!isRecord(parsed)) return skip(`${lockName} is not an object`)
    lock = parsed
  } catch {
    return skip(`${lockName} cannot be read`)
  }
  const bun = lockName === 'bun.lock'
  const problem = bun
    ? bunLockProblem(lock, pkg)
    : npmLockProblem(lock, pkg, opts.defaultRegistry ?? 'https://registry.npmjs.org')
  if (problem) return skip(problem)

  const work = await fs.mkdtemp(join(tmpdir(), 'localix-plugin-deps-'))
  try {
    await fs.writeFile(join(work, 'package.json'), pkgText)
    await fs.writeFile(join(work, lockName), lockText)
    const [command, args] = bun
      ? ['bun', ['install', '--frozen-lockfile', '--ignore-scripts']]
      : ['npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']]
    await (opts.run ?? defaultRun)(command, args, work)
    const built = join(work, 'node_modules')
    if (!(await fs.stat(built).catch(() => null))?.isDirectory()) return { installed: true }
    await fs.rm(join(pluginDir, 'node_modules'), { recursive: true, force: true })
    await fs.cp(built, join(pluginDir, 'node_modules'), { recursive: true, verbatimSymlinks: true })
    return { installed: true }
  } catch (error) {
    return skip(`the ${bun ? 'bun' : 'npm'} install failed (${errorMessage(error)})`)
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}
