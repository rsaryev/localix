import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CommandRunner } from '@rsaryev/llx-plugin'
import {
  installOutcome,
  LOCKFILE_NAMES,
  nodeDepsNote,
  nodeDepsRun,
  planNodeDepsInstall,
  readLockfile,
  readPackageJson,
  UNSUPPORTED_LOCKFILES,
  type LockfileFacts,
  type LockfileName,
  type NodeDepsInput,
  type NodeDepsInstall,
  type PackageManager,
  type ReadPackageJson,
} from '@rsaryev/llx-plugin/marketplace'
import { childEnvNonInteractive } from '../../../../lib/login-shell-env'
import { hostCommandRunner } from '../ports/command-runner'

/**
 * A copied plugin's Node.js packages, installed as Claude Code installs them (loading.md, "Node.js
 * package dependencies"): the kit decides whether and how (`planNodeDepsInstall`), what a run that
 * failed means (`installOutcome`) and what the person is told (`nodeDepsNote`). Localix reads the
 * plugin's files, makes the install folder, runs the package manager through its `CommandRunner`
 * and moves `node_modules` back.
 */

const PACKAGE_MANAGERS: readonly PackageManager[] = ['bun', 'npm']
const OUTPUT_BYTES = 1024 * 1024

const readText = (file: string): Promise<string | undefined> =>
  fs.readFile(file, 'utf8').catch(() => undefined)

const exists = (path: string): Promise<boolean> =>
  fs.stat(path).then(
    () => true,
    () => false,
  )

const definedOnly = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => !!entry[1]))

function parsedPackageJson(text: string | undefined): ReadPackageJson | undefined {
  if (text === undefined) return undefined
  try {
    return readPackageJson(JSON.parse(text))
  } catch {
    return 'unreadable'
  }
}

async function lockfilesOf(pluginDir: string) {
  const lockfiles: { [N in LockfileName]?: LockfileFacts } = {}
  for (const name of LOCKFILE_NAMES) {
    const text = await readText(join(pluginDir, name))
    if (text !== undefined) lockfiles[name] = readLockfile(name, text)
  }
  const others = await Promise.all(
    UNSUPPORTED_LOCKFILES.map(async (name) =>
      (await exists(join(pluginDir, name))) ? [name] : [],
    ),
  )
  return { lockfiles, otherLockfiles: others.flat() }
}

/** Copies the two files in, runs the package manager, and moves `node_modules` into the plugin. */
async function runInstall(
  plan: NodeDepsInstall,
  runner: CommandRunner,
  env: Record<string, string>,
) {
  for (const file of plan.stage.copy) await fs.copyFile(file.from, file.to)
  const result = await runner.run(nodeDepsRun(plan, env, { signal: new AbortController().signal }))
  const outcome = installOutcome(result)
  if (outcome.state === 'failed') return outcome.message
  const { from, to } = plan.stage.moveBack
  if (!(await exists(from))) return undefined
  await fs.rm(to, { recursive: true, force: true })
  await fs.cp(from, to, { recursive: true, verbatimSymlinks: true })
  return undefined
}

/**
 * Installs the Node.js packages of the plugin copied to `pluginDir`; the note to show when they
 * were not installed, or undefined when they were or the plugin lists none.
 */
export async function installNodeDependencies(
  pluginDir: string,
  options: { runner?: CommandRunner; defaultRegistry?: string } = {},
): Promise<string | undefined> {
  const env = definedOnly(childEnvNonInteractive())
  const installDir = await fs.mkdtemp(join(tmpdir(), 'localix-plugin-deps-'))
  try {
    const packageJson = parsedPackageJson(await readText(join(pluginDir, 'package.json')))
    const found = await lockfilesOf(pluginDir)
    const input: NodeDepsInput = {
      origin: 'copied',
      pluginRoot: pluginDir,
      installDir,
      join,
      packageJson,
      ...found,
      available: PACKAGE_MANAGERS.filter((name) => Bun.which(name, { PATH: env.PATH ?? '' })),
      ...(options.defaultRegistry ? { defaultRegistry: options.defaultRegistry } : {}),
    }
    const { plan } = planNodeDepsInstall(input)
    if (plan.action === 'install')
      return await runInstall(
        plan,
        options.runner ?? hostCommandRunner({ maxOutputBytes: OUTPUT_BYTES }),
        env,
      )
    const copy = {
      enabled: true,
      hasLockfile: Object.keys(found.lockfiles).length + found.otherLockfiles.length > 0,
      packageJson,
      hasNodeModules: await exists(join(pluginDir, 'node_modules')),
    }
    return nodeDepsNote(copy, plan, pluginDir)?.text
  } finally {
    await fs.rm(installDir, { recursive: true, force: true })
  }
}
