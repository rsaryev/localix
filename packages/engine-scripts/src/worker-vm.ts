/**
 * A LONG-LIVED VM in the worker (`worker.ts`, started by `vm.ts`): one QuickJS VM that lives until
 * the host stops it, running a runtime the host hands it and the messages the host delivers.
 *
 * The VM starts with no code generation (`eval`, `Function`) and with the web APIs its extensions
 * give (`vm-prelude.ts`), then the runtime is evaluated as the
 * body of `function (host) { … }`, then every built-in is frozen (`MODULE_LOCKDOWN_SOURCE`). The
 * runtime's only way out is `host`: `post(json)` sends the host text, `listen(receive)` names the
 * function each delivered message's text is handed to, and `evaluate(source, name)` runs code the
 * runtime was handed (a module), which its own code cannot do.
 *
 * Work runs in turns: a delivered message and every promise job it starts. A turn past `sliceMs`
 * is interrupted, and the VM is done for — it held its thread. So is one that posts more than its
 * `postLimits` (messages, or characters in all) in a turn. An allocation past the memory limit
 * throws `InternalError: out of memory` in the VM, which the runtime may catch. A job that throws,
 * or a runtime that throws to its caller, ends the VM too. Rejections no one handled by the end of
 * a turn are reported, as an ordinary runtime reports them once its microtasks ran.
 */
import { parentPort } from 'node:worker_threads'

import type { JSValueHandle, QuickJS } from 'quickjs-wasi'

import { MODULE_LOCKDOWN_SOURCE } from './lockdown'
import { isVmHostMessage, type VmWorkerData, type VmWorkerMessage } from './protocol'
import { createQuickJs, describeValue, runPendingJobs } from './quickjs'
import { NO_CODE_GENERATION_SOURCE, URL_SEARCH_PARAMS_SOURCE } from './vm-prelude'

const send = (message: VmWorkerMessage) => parentPort?.postMessage(message)

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message || error.name : String(error)

/** A string argument of the runtime's, refused otherwise: converting it would run guest code. */
function textOf(handle: JSValueHandle | undefined, what: string): string {
  if (!handle?.isString) throw new TypeError(`${what} takes a string`)
  return handle.toString()
}

export async function startVm(data: VmWorkerData): Promise<void> {
  const flag = new Int32Array(data.interrupt)
  let deadline = 0
  let overran = false
  let ended = false
  /** Why the current turn posted past its limits, once it did. */
  let flooded: string | undefined
  let posted = { messages: 0, characters: 0 }
  const interrupted = () => {
    if (overran || flooded !== undefined || Atomics.load(flag, 0) !== 0) return true
    if (deadline !== 0 && performance.now() > deadline) overran = true
    return overran
  }
  const exit = (reason: string) => {
    if (ended) return
    ended = true
    send({ type: 'exit', reason })
  }

  /** Rejections no handler took yet, by the promise's identity, reported when a turn ends. */
  const unhandled = new Map<number, string>()
  let vm: QuickJS
  try {
    vm = await createQuickJs({
      wasm: data.wasm,
      memoryLimitBytes: data.memoryLimitBytes,
      interrupted,
      extensions: data.extensions.map((one) => ({ name: one.name, wasm: one.wasm as never })),
      onUnhandledRejection(promise, reason, handled) {
        if (handled) unhandled.delete(promise.identity)
        else unhandled.set(promise.identity, describeValue(reason))
      },
    })
  } catch (error) {
    exit(`did not start: ${messageOf(error)}`)
    return
  }

  /** Handles the runtime was answered with, freed once the turn is over. */
  const answered: JSValueHandle[] = []
  let receiver: JSValueHandle | undefined

  const host = vm.newObject()
  const lend = (name: string, fn: (...args: JSValueHandle[]) => JSValueHandle) => {
    const handle = vm.newFunction(name, fn)
    host.setProp(name, handle)
    handle.dispose()
  }
  lend('post', (json) => {
    const text = textOf(json, 'host.post')
    const limits = data.postLimits
    posted = { messages: posted.messages + 1, characters: posted.characters + text.length }
    if (posted.messages > limits.messages)
      flooded = `posted more than ${limits.messages} messages in one turn`
    else if (posted.characters > limits.characters)
      flooded = `posted more than ${limits.characters} characters in one turn`
    if (flooded !== undefined) throw new Error(flooded)
    send({ type: 'message', json: text })
    return vm.undefined
  })
  lend('listen', (fn) => {
    if (receiver) throw new Error('host.listen was called already')
    if (!fn?.isFunction) throw new TypeError('host.listen takes a function')
    receiver = fn.dup()
    return vm.undefined
  })
  lend('evaluate', (source, name) => {
    const value = vm.evalCode(textOf(source, 'host.evaluate'), textOf(name, 'host.evaluate'))
    answered.push(value)
    return value
  })

  /** One turn: `work`, then the jobs it started, within the turn's time. */
  const turn = (work: () => void) => {
    if (ended) return
    deadline = performance.now() + data.sliceMs
    posted = { messages: 0, characters: 0 }
    try {
      work()
      runPendingJobs(vm, interrupted)
    } catch (error) {
      if (!overran && flooded === undefined) exit(`crashed: ${messageOf(error)}`)
    } finally {
      deadline = 0
      for (const handle of answered.splice(0)) handle.dispose()
    }
    if (flooded !== undefined) return exit(flooded)
    if (overran) return exit(`held its thread for ${data.sliceMs} ms`)
    for (const message of unhandled.values()) send({ type: 'rejection', message })
    unhandled.clear()
  }

  turn(() => {
    vm.evalCode(NO_CODE_GENERATION_SOURCE, 'vm-prelude.js').dispose()
    vm.evalCode(URL_SEARCH_PARAMS_SOURCE, 'vm-prelude.js').dispose()
    const runtime = vm.evalCode(`(function (host) {"use strict";\n${data.runtime}\n})`, data.name)
    try {
      vm.callFunction(runtime, vm.undefined, host).dispose()
    } finally {
      runtime.dispose()
      host.dispose()
    }
    vm.evalCode(MODULE_LOCKDOWN_SOURCE, 'lockdown.js').dispose()
    if (!receiver) throw new Error('the runtime did not call host.listen')
  })

  parentPort?.on('message', (message: unknown) => {
    if (!isVmHostMessage(message) || !receiver) return
    const listener = receiver
    turn(() => {
      const json = vm.newString(message.json)
      try {
        vm.callFunction(listener, vm.undefined, json).dispose()
      } finally {
        json.dispose()
      }
    })
  })
}
