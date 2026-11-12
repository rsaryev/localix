import { expect, setDefaultTimeout, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createScriptVms } from '@localixai/engine-scripts'
import { INERT_MOD_PORTS, type ModSource } from './contracts'
import { createModsHost } from './host'
import type { ModVmPort } from './isolation/mod-vm'
import { manualClock } from './isolation/testing/testing-mods'

/** A deleted conversation's mods go with it: its host and its VMs, and what was kept for it. */

const scratch = tempDirPerTest('mods-host-forget', {})

// Real VMs start cold here and the collector is waited for: seconds on a busy CI runner.
setDefaultTimeout(30_000)

/**
 * Real VMs, counted while they run, and the threads that hold at least one of them; what each VM
 * was started with is held weakly (`kept`), so a test sees whether anything still holds it.
 */
function countedVms() {
  const real = createScriptVms()
  const counted = { live: 0, threads: 0 }
  const started: WeakRef<object>[] = []
  /**
   * How many of the VMs started from the `from`th on are still held by anything. The collector also
   * scans the stack, which a turn of the event loop leaves empty, and a stopped thread lets go some
   * turns later when the process is busy: it is asked again, for up to a second, until none is held.
   * A VM that something really holds is still counted when that second is over.
   */
  const kept = async (from: number) => {
    const held = () => started.slice(from).filter((ref) => ref.deref() !== undefined).length
    for (let turn = 0; turn < 50; turn++) {
      await new Promise((resolve) => setTimeout(resolve, turn === 0 ? 0 : 20))
      Bun.gc(true)
      if (held() === 0) break
    }
    return held()
  }
  const vms: ModVmPort = {
    thread() {
      const thread = real.thread()
      let members = 0
      const joined = () => void (members++ === 0 && counted.threads++)
      const left = () => void (--members === 0 && counted.threads--)
      return {
        start(input) {
          started.push(new WeakRef(input))
          counted.live++
          joined()
          let gone = false
          const done = () => void (gone || ((gone = true), counted.live--, left()))
          const vm = thread.start({ ...input, onExit: (reason) => (done(), input.onExit(reason)) })
          return { send: (json) => vm.send(json), stop: () => (done(), vm.stop()) }
        },
      }
    },
  }
  return { vms, counted, kept }
}

/** A host with one mod, `echo`, loaded for the workspace and for conversation `s1`. */
async function echoHost(more: { idleMs?: number; clock?: ReturnType<typeof manualClock> } = {}) {
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
  const { vms, counted, kept } = countedVms()
  const host = createModsHost(
    { ...INERT_MOD_PORTS, workspaceDir: dir },
    { vms, homeDir: dir, managed: null, ...more },
  )
  await host.reconcile([source])
  const scene = { userId: 'u1', sessionId: 's1', cwd: dir }
  const plugins = new Set(['echo'])
  host.conversations.joined(scene, plugins)
  await host.runCommand({ command: 'x' }, scene, plugins)
  return { host, counted, kept }
}

test("forgetting a conversation disposes its mods host and lets go of its mods' VMs and thread", async () => {
  const { host, counted, kept } = await echoHost()
  expect(counted).toEqual({ live: 2, threads: 2 })

  await host.forget('s1')
  expect(counted).toEqual({ live: 1, threads: 1 })
  expect(await kept(1)).toBe(0)
  expect(host.conversations.of('s1')).toBeUndefined()
  await host.stop()
  expect(counted).toEqual({ live: 0, threads: 0 })
  expect(await kept(0)).toBe(0)
})

test("an idle conversation's mods host goes with its mods' VMs and thread", async () => {
  const clock = manualClock()
  const { host, counted, kept } = await echoHost({ idleMs: 40, clock })
  expect(counted).toEqual({ live: 2, threads: 2 })

  clock.advance(40)
  await host.settled()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(counted).toEqual({ live: 1, threads: 1 })
  expect(await kept(1)).toBe(0)
  await host.stop()
})
