import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createScriptVms } from '@localixai/engine-scripts'
import type { ModsHostOptions as KitModsHostOptions } from '@rsaryev/llx-plugin/mods'
import { createModsHost, diskFiles } from '../../plugins/kit'
import { modsTesting } from '../../plugins/kit/testing'
import { createModuleCompiler } from '../module-build'
import { createVmRuntime } from './vm-runtime'

/** The kit's mods host running real hooks modules, each in a Localix VM, over the kit's fakes. */

const vms = createScriptVms()
const scratch = tempDirPerTest('mods-vm-runtime', {})
const REAL_CLOCK = {
  now: () => Date.now(),
  setTimer(fire: () => void, ms: number) {
    const timer = setTimeout(fire, ms)
    return () => clearTimeout(timer)
  },
}

async function hostWith(mods: Record<string, string>, overrides: Partial<KitModsHostOptions> = {}) {
  const dir = scratch()
  const died: string[] = []
  const lines: string[] = []
  const host = createModsHost({
    ports: modsTesting.fakePorts().ports,
    iface: modsTesting.fakeModInterface(),
    runtime: createVmRuntime({
      vms: vms.thread(),
      hangMs: 2_000,
      memoryLimitBytes: 32 * 1024 * 1024,
      clock: REAL_CLOCK,
      report: (plugin, message) => void lines.push(`${plugin}: ${message}`),
      died: (plugin, reason) => void died.push(`${plugin}: ${reason}`),
    }),
    compiler: createModuleCompiler(),
    policy: {
      user: {},
      credential: 'api-key',
      env: {},
      platform: 'posix',
      flags: { pluginDirs: [] },
    },
    deny: { verdict: () => Promise.resolve('none') },
    report: (report) => void lines.push(JSON.stringify(report)),
    ...overrides,
  })
  const plugins = Object.entries(mods).map(([name, code]) => {
    const root = join(dir, name)
    writeTree(root, {
      '.claude-plugin/plugin.json': JSON.stringify({ name, version: '1.0.0' }),
      'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),
      'hooks/register.js': code,
    })
    const candidate = { id: `${name}@inline`, name, isBuiltin: false, dependencies: [] }
    return { candidate, files: diskFiles(root) }
  })
  const report = await host.load(plugins)
  return { host, report, died, lines }
}

test('a hooks module runs in its VM under the kit: a command answers, with $ from the kit', async () => {
  const { host, report } = await hostWith({
    greeter: `export function register(on) {
      on('command.run', { command: 'hello' }, async ($, e, next) => ({
        text: 'hello ' + e.args + ' from ' + next.event + (next.is('command.*') ? ' (command)' : ''),
      }))
    }`,
  })
  expect(report.lines).toEqual([])
  expect(report.loaded.map((mod) => mod.name)).toEqual(['greeter'])
  expect(await host.runCommand('hello', 'there')).toEqual({
    text: 'hello there from command.run (command)',
  })
})

test('a RegExp matcher is tested in the VM: a miss passes the event on', async () => {
  const { host } = await hostWith({
    picky: `export function register(on) {
      on('command.run', { command: /^de/ }, async () => ({ text: 'matched' }))
      on('command.run', { command: 'other' }, async () => ({ text: 'other' }))
    }`,
  })
  expect(await host.runCommand('deploy', '')).toEqual({ text: 'matched' })
  expect(await host.runCommand('other', '')).toEqual({ text: 'other' })
})

test('next() with no event rejects inside the VM, naming the hook', async () => {
  const { host } = await hostWith({
    lazy: `export function register(on) {
      on('command.run', { command: 'x' }, async ($, e, next) => {
        try { await next() } catch (error) { return { text: String(error.message) } }
        return { text: 'passed' }
      })
    }`,
  })
  expect(await host.runCommand('x', '')).toEqual({
    text: 'next() takes the event: the command.run hook of lazy called it with none',
  })
})

test('a module that fails to register is a load line, and nothing of it runs', async () => {
  const { report } = await hostWith({
    broken: `export function register() { throw new Error('nope') }`,
  })
  expect(report.loaded).toEqual([])
  expect(report.lines.join('\n')).toContain('nope')
})
