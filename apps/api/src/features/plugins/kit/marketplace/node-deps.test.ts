import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CommandRun, CommandRunner } from '@rsaryev/llx-plugin'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import { installNodeDependencies } from './node-deps'

/**
 * Localix's side of a copied plugin's Node.js package install (loading.md, "Node.js package
 * dependencies"): the kit plans it and words the note (its tests cover each lockfile rule);
 * Localix reads the plugin's files, runs the plan in a folder of its own through its
 * `CommandRunner`, and moves `node_modules` into the plugin.
 */

const dir = tempDirPerTest('kit-node-deps-')

const BUN_LOCK = '{ "lockfileVersion": 1, "workspaces": { "": { "name": "p" } }, "packages": {}, }'

/** A package manager that records how it ran, lays down one package and exits `exitCode`. */
function recorder(exitCode = 0) {
  const runs: Array<{ run: CommandRun; files: string[] }> = []
  const runner: CommandRunner = {
    run: async (run) => {
      runs.push({ run, files: readdirSync(run.cwd ?? '').sort() })
      if (exitCode === 0)
        writeTree(run.cwd ?? '', { 'node_modules/left-pad/index.js': 'module.exports = 1' })
      return { exitCode, stdout: exitCode ? 'ERR! 404' : '', stderr: '', timedOut: false }
    },
  }
  return { runs, runner }
}

describe("a copied plugin's Node.js packages", () => {
  it('install in a folder holding only the dependency list, scripts off, then move in', async () => {
    const plugin = join(dir(), 'plugin')
    writeTree(plugin, {
      'package.json': JSON.stringify({ name: 'p' }),
      'bun.lock': BUN_LOCK,
      '.npmrc': 'registry=https://evil.example\n',
    })
    const { runs, runner } = recorder()
    expect(await installNodeDependencies(plugin, { runner })).toBeUndefined()
    expect(runs).toHaveLength(1)
    const [{ run, files }] = runs as [(typeof runs)[number]]
    expect(run.spec).toMatchObject({ form: 'exec', command: 'bun' })
    expect(run.spec.form === 'exec' && run.spec.args).toContain('--ignore-scripts')
    expect(run.cwd?.startsWith(plugin)).toBe(false)
    expect(files).toEqual(['bun.lock', 'package.json'])
    expect(readFileSync(join(plugin, 'node_modules/left-pad/index.js'), 'utf8')).toBe(
      'module.exports = 1',
    )
    expect(existsSync(run.cwd ?? '')).toBe(false)
  })

  it('a lockfile the install cannot use is the kit’s note, and nothing runs', async () => {
    const plugin = join(dir(), 'yarn')
    writeTree(plugin, {
      'package.json': JSON.stringify({ name: 'p', dependencies: { a: '1.0.0' } }),
      'yarn.lock': '',
    })
    const { runs, runner } = recorder()
    const note = await installNodeDependencies(plugin, { runner })
    expect(note).toStartWith('The packages it lists were not installed, because it has a yarn.lock')
    expect(runs).toHaveLength(0)
  })

  it('a failed run is told with its exit code and output, and leaves no node_modules', async () => {
    const plugin = join(dir(), 'failing')
    writeTree(plugin, { 'package.json': JSON.stringify({ name: 'p' }), 'bun.lock': BUN_LOCK })
    const note = await installNodeDependencies(plugin, { runner: recorder(1).runner })
    expect(note).toBe('The dependency install failed with exit code 1.\nERR! 404')
    expect(existsSync(join(plugin, 'node_modules'))).toBe(false)
  })

  it('a plugin without a package.json is left alone, with no note', async () => {
    const plugin = join(dir(), 'plain')
    writeTree(plugin, { '.claude-plugin/plugin.json': '{"name":"plain"}' })
    const { runs, runner } = recorder()
    expect(await installNodeDependencies(plugin, { runner })).toBeUndefined()
    expect(runs).toHaveLength(0)
  })
})
