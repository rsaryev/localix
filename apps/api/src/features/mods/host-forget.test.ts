import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createScriptVms } from '@localixai/engine-scripts'
import { INERT_MOD_PORTS, type ModSource } from './contracts'
import { createModsHost } from './host'
import type { ModVmPort } from './isolation/mod-vm'

/** A deleted conversation's mods go with it: its host and its VMs, and what was kept for it. */

const scratch = tempDirPerTest('mods-host-forget', {})

/** Real VMs, counted while they run. */
function countedVms() {
  const real = createScriptVms()
  const counted = { live: 0 }
  const vms: ModVmPort = {
    start(input) {
      counted.live++
      let gone = false
      const done = () => void (gone || ((gone = true), counted.live--))
      const vm = real.start({ ...input, onExit: (reason) => (done(), input.onExit(reason)) })
      return { send: (json) => vm.send(json), stop: () => (done(), vm.stop()) }
    },
  }
  return { vms, counted }
}

test("forgetting a conversation disposes its mods host and stops its mods' VMs", async () => {
  const dir = scratch()
  const root = join(dir, 'echo')
  writeTree(root, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'echo', version: '1.0.0' }),
    'hooks/hooks.json': JSON.stringify({ modules: ['./register.js'] }),
    'hooks/register.js': `export function register(on) { on('command.run', () => ({ text: 'echo' })) }`,
  })
  const source: ModSource = {
    plugin: 'echo',
    root,
    module: join(root, 'hooks/register.js'),
    options: {},
    revision: '1',
  }
  const { vms, counted } = countedVms()
  const host = createModsHost(
    { ...INERT_MOD_PORTS, workspaceDir: dir },
    { vms, homeDir: dir, managed: null },
  )
  await host.reconcile([source])
  const scene = { userId: 'u1', sessionId: 's1', cwd: dir }
  const plugins = new Set(['echo'])
  host.conversations.joined(scene, plugins)
  await host.runCommand({ command: 'x' }, scene, plugins)
  expect(counted.live).toBe(2)

  await host.forget('s1')
  expect(counted.live).toBe(1)
  expect(host.conversations.of('s1')).toBeUndefined()
  await host.stop()
  expect(counted.live).toBe(0)
})
