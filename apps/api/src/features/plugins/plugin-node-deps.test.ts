import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { installNodeDependencies, type PackageManagerRun } from './plugin-node-deps'

/**
 * A copied plugin's Node.js packages install from its lockfile (loading.md, "Node.js package
 * dependencies"): the lockfile picks the package manager, scripts never run, the install happens
 * in a folder of its own and its `node_modules` moves into the plugin; a lockfile Claude Code
 * cannot check, or a dependency that is not a pinned registry package, gets no install.
 */

const dir = tempDirPerTest('plugin-node-deps-')

const packageJson = (deps: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'p', dependencies: deps, ...extra })

const npmLock = (packages: Record<string, unknown>, rootDeps: Record<string, string>) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: { '': { dependencies: rootDeps }, ...packages },
  })

/** A package manager that records how it ran and lays down one package. */
function recorder() {
  const runs: { command: string; args: string[]; cwd: string; files: string[] }[] = []
  const run: PackageManagerRun = async (command, args, cwd) => {
    const { readdirSync } = await import('node:fs')
    runs.push({ command, args, cwd, files: readdirSync(cwd).sort() })
    writeTree(cwd, { 'node_modules/left-pad/index.js': 'module.exports = 1' })
  }
  return { runs, run }
}

describe('a plugin with a package.json and a lockfile', () => {
  it('installs with npm, scripts off, in a folder holding only the dependency list', async () => {
    const plugin = join(dir(), 'plugin')
    writeTree(plugin, {
      'package.json': packageJson({ 'left-pad': '1.3.0' }),
      'package-lock.json': npmLock(
        {
          'node_modules/left-pad': {
            version: '1.3.0',
            resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz',
          },
        },
        { 'left-pad': '1.3.0' },
      ),
      '.npmrc': 'registry=https://evil.example\n',
    })
    const { runs, run } = recorder()
    expect(
      await installNodeDependencies(plugin, { run, defaultRegistry: 'https://registry.npmjs.org' }),
    ).toEqual({
      installed: true,
    })
    expect(runs).toHaveLength(1)
    expect(runs[0]!.command).toBe('npm')
    expect(runs[0]!.args).toContain('--ignore-scripts')
    expect(runs[0]!.cwd).not.toBe(plugin)
    expect(runs[0]!.files).toEqual(['package-lock.json', 'package.json'])
    expect(readFileSync(join(plugin, 'node_modules/left-pad/index.js'), 'utf8')).toBe(
      'module.exports = 1',
    )
  })

  it('picks bun for a bun.lock first', async () => {
    const plugin = join(dir(), 'plugin')
    writeTree(plugin, {
      'package.json': packageJson({}),
      'bun.lock':
        '{ "lockfileVersion": 1, "workspaces": { "": { "name": "p" } }, "packages": {}, }',
      'package-lock.json': npmLock({}, {}),
    })
    const { runs, run } = recorder()
    await installNodeDependencies(plugin, { run })
    expect(runs[0]?.command).toBe('bun')
    expect(runs[0]?.args).toContain('--ignore-scripts')
  })

  it('gets no install, with the reason, when the lockfile cannot be checked', async () => {
    const cases: Record<string, Record<string, string>> = {
      yarn: { 'package.json': packageJson({ a: '1.0.0' }), 'yarn.lock': '' },
      git: {
        'package.json': packageJson({ a: 'github:o/a' }),
        'package-lock.json': npmLock(
          { 'node_modules/a': { version: '1.0.0', resolved: 'git+ssh://git@github.com/o/a.git' } },
          { a: 'github:o/a' },
        ),
      },
      mismatch: {
        'package.json': packageJson({ a: '1.0.0', b: '1.0.0' }),
        'package-lock.json': npmLock({}, { a: '1.0.0' }),
      },
      overrides: {
        'package.json': packageJson({}, { overrides: { a: '2.0.0' } }),
        'package-lock.json': npmLock({}, {}),
      },
    }
    for (const [name, tree] of Object.entries(cases)) {
      const plugin = join(dir(), name)
      writeTree(plugin, tree)
      const { runs, run } = recorder()
      const result = await installNodeDependencies(plugin, { run })
      expect({ name, installed: result.installed, ran: runs.length }).toEqual({
        name,
        installed: false,
        ran: 0,
      })
      expect(result.skipped).toBeTruthy()
      expect(existsSync(join(plugin, 'node_modules'))).toBe(false)
    }
  })

  it('does nothing for a plugin without a package.json', async () => {
    const plugin = join(dir(), 'plain')
    writeTree(plugin, { '.claude-plugin/plugin.json': '{"name":"plain"}' })
    expect(await installNodeDependencies(plugin, { run: recorder().run })).toEqual({
      installed: false,
    })
  })
})
