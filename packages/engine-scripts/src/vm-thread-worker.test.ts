import { expect, mock, test } from 'bun:test'
import * as threads from 'node:worker_threads'

import type { ScriptVmThread } from './vm'

/**
 * What a thread of VMs costs the process: one worker however many VMs it runs, started with the
 * first and ended — `terminate()` — with the last, so a conversation's mods leave no worker behind.
 * The real `Worker` runs underneath; it is only counted.
 */
const workers = { started: 0, ended: 0 }
class CountedWorker extends threads.Worker {
  constructor(...args: ConstructorParameters<typeof threads.Worker>) {
    super(...args)
    workers.started += 1
  }

  override terminate() {
    workers.ended += 1
    return super.terminate()
  }
}
void mock.module('node:worker_threads', () => ({ ...threads, Worker: CountedWorker }))
/** The module under test, imported once `Worker` is counted. */
const threadOfVms = async () =>
  (await import('./vm')).createScriptVms({ memoryLimitBytes: 16 * 1024 * 1024 }).thread()

/** A VM that answers each message with the count of messages it saw. */
function counter(thread: ScriptVmThread) {
  let arrived = (_json: string) => {}
  const vm = thread.start({
    name: 'counter.js',
    sliceMs: 5_000,
    runtime: 'let seen = 0; host.listen(() => host.post(String(++seen)))',
    onMessage: (json) => arrived(json),
    onExit: () => {},
  })
  const ask = () =>
    new Promise<string>((resolve) => {
      arrived = resolve
      vm.send('"go"')
    })
  return { vm, ask }
}

test('a thread runs its VMs in one worker, ends it with the last, and starts a fresh one after', async () => {
  const thread = await threadOfVms()
  const a = counter(thread)
  const b = counter(thread)
  const c = counter(thread)
  expect(await Promise.all([a.ask(), b.ask(), c.ask()])).toEqual(['1', '1', '1'])
  expect(workers).toEqual({ started: 1, ended: 0 })

  a.vm.stop()
  b.vm.stop()
  expect(workers.ended).toBe(0)
  c.vm.stop()
  expect(workers).toEqual({ started: 1, ended: 1 })

  const d = counter(thread)
  expect(await d.ask()).toBe('1')
  expect(workers).toEqual({ started: 2, ended: 1 })
  d.vm.stop()
  expect(workers).toEqual({ started: 2, ended: 2 })
})
