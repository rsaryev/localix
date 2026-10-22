import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { createScriptVms } from '@localixai/engine-scripts'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { INERT_MOD_PORTS, type ModSource } from './contracts'
import { createModsHost } from './host'
import { instanceIdOf } from './instance-id'

const scratch = tempDirPerTest('mods-host-state', {})

/** `hello-tabs`'s counter from Claude Code's "Keep a value in $.state", in a pane. */
const COUNTER = `
import { atom, read, update } from 'claude-code'
const count = atom({ plugin: 'counter', key: 'count' }, 0)
export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.ui.open({ id: 'p', title: 'Counter' })
    return next(e)
  })
  on('ui.render', { component: 'Pane', requestId: 'p' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const n = await read($, count)
    return Box({
      children: [
        Text({ children: ['Count: ' + n] }),
        Button({ key: 'more', label: 'Add one', onPress: () => update($, count, (v) => v + 1) }),
      ],
    })
  })
  on('command.run', { command: 'bump' }, async ($) => {
    await update($, count, (v) => v + 10)
    return { text: 'bumped' }
  })
}
`

test('$.state keeps a pane’s value: a write redraws it, a reload keeps it, a reset clears it', async () => {
  const dir = scratch()
  const root = join(dir, 'counter')
  writeTree(root, {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'counter' }),
    'hooks/register.js': COUNTER,
  })
  let changes = 0
  const reports: string[] = []
  const host = createModsHost(
    {
      ...INERT_MOD_PORTS,
      dataDir: (plugin) => join(dir, 'data', plugin),
      workspaceDir: dir,
      changed: () => (changes += 1),
      report: (plugin, message) => reports.push(`${plugin}: ${message}`),
    },
    { vms: createScriptVms() },
  )
  const source: ModSource = {
    plugin: 'counter',
    root,
    module: join(root, 'hooks/register.js'),
    options: {},
    revision: '1',
  }
  const pane = instanceIdOf('counter', dir)
  const shown = async () => JSON.stringify((await host.panes.render(pane, 'p'))?.tree)

  await host.reconcile([source])
  expect(reports).toEqual([])
  expect(await shown()).toContain('Count: 0')
  await host.panes.interact(pane, 'p', { kind: 'press', element: 'more' })
  expect(await shown()).toContain('Count: 1')

  // A write from another event redraws the pane that read the value, with no $.ui.invalidate.
  const before = changes
  const scene = { userId: 'u', cwd: dir }
  expect(await host.runCommand({ command: 'bump' }, scene, new Set(['counter']))).toEqual({
    text: 'bumped',
  })
  expect(changes).toBe(before + 1)
  expect(await shown()).toContain('Count: 11')

  // A reload of the module (its source changed) keeps the value.
  await host.reconcile([{ ...source, revision: '2' }])
  expect(await shown()).toContain('Count: 11')

  // Claude Code's /clear: every value back to its default.
  host.state.reset(dir)
  expect(await shown()).toContain('Count: 0')
  await host.stop()
})
