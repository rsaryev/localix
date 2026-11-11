/**
 * A THREAD OF LONG-LIVED VMs in the worker (`worker.ts`, started by `vm.ts`): QuickJS VMs that live
 * until the host stops them, each running a runtime the host hands it and the messages the host
 * delivers to it. Each VM is an instance of QuickJS of its own, with its own linear memory: one
 * cannot reach another's heap, as none can reach the worker's. They share the thread, so a turn of
 * one waits for a turn of another to end.
 *
 * A VM starts with no code generation (`eval`, `Function`) and with the web APIs its extensions
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
 * a turn are reported, as an ordinary runtime reports them once its microtasks ran. A VM that ends,
 * or that the host stops, is freed here: nothing of it stays reachable, so its memory goes with the
 * worker's next collection.
 */
import { parentPort } from 'node:worker_threads'

import type { JSValueHandle, QuickJS } from 'quickjs-wasi'

import { MODULE_LOCKDOWN_SOURCE } from './lockdown'
import { isVmHostMessage, type VmSpec, type VmThreadData, type VmWorkerMessage } from './protocol'
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

/** A VM of the thread, as the host's messages reach it. */
interface ThreadVm {
  deliver(json: string): void
  /** Frees the VM; nothing is sent. */
  free(): void
}

/**
 * The thread: each VM by the id the host started it under, until it ends or the host stops it.
 * Messages for a VM still starting wait for it, in order.
 */
export function startVmThread(data: VmThreadData): void {
  const vms = new Map<number, Promise<ThreadVm | undefined>>()
  parentPort?.on('message', (message: unknown) => {
    if (!isVmHostMessage(message)) return
    const id = message.vm
    if (message.type === 'start') {
      if (!vms.has(id))
        vms.set(
          id,
          startVm(data, id, message.spec, () => vms.delete(id)),
        )
      return
    }
    const vm = vms.get(id)
    if (message.type === 'stop') {
      vms.delete(id)
      void vm?.then((one) => one?.free())
    } else {
      const { json } = message
      void vm?.then((one) => one?.deliver(json))
    }
  })
}

async function startVm(
  data: VmThreadData,
  id: number,
  spec: VmSpec,
  forget: () => void,
): Promise<ThreadVm | undefined> {
  const flag = new Int32Array(spec.interrupt)
  let deadline = 0
  let overran = false
  let ended = false
  /** Why the current turn posted past its limits, once it did. */
  let flooded: string | undefined
  let posted = { messages: 0, characters: 0 }
  const stopped = () => Atomics.load(flag, 0) !== 0
  const interrupted = () => {
    if (overran || flooded !== undefined || stopped()) return true
    if (deadline !== 0 && performance.now() > deadline) overran = true
    return overran
  }
  /** The VM is done for; the host hears why, unless it stopped the VM itself. */
  const exit = (reason: string) => {
    if (ended) return
    ended = true
    forget()
    if (!stopped()) send({ type: 'exit', vm: id, reason })
  }

  /** Rejections no handler took yet, by the promise's identity, reported when a turn ends. */
  const unhandled = new Map<number, string>()
  let vm: QuickJS
  try {
    vm = await createQuickJs({
      wasm: data.wasm,
      memoryLimitBytes: spec.memoryLimitBytes,
      interrupted,
      extensions: data.extensions.map((one) => ({ name: one.name, wasm: one.wasm as never })),
      onUnhandledRejection(promise, reason, handled) {
        if (handled) unhandled.delete(promise.identity)
        else unhandled.set(promise.identity, describeValue(reason))
      },
    })
  } catch (error) {
    exit(`did not start: ${messageOf(error)}`)
    return undefined
  }

  /** Handles the runtime was answered with, freed once the turn is over. */
  const answered: JSValueHandle[] = []
  let receiver: JSValueHandle | undefined
  /** Its handles, then its runtime; the instance and its memory are the worker's GC's to collect. */
  const free = () => {
    ended = true
    receiver?.dispose()
    receiver = undefined
    unhandled.clear()
    try {
      vm.dispose()
    } catch {
      // A runtime freed with objects of its own still alive traps; the instance is dropped anyway.
    }
  }

  const host = vm.newObject()
  const lend = (name: string, fn: (...args: JSValueHandle[]) => JSValueHandle) => {
    const handle = vm.newFunction(name, fn)
    host.setProp(name, handle)
    handle.dispose()
  }
  lend('post', (json) => {
    const text = textOf(json, 'host.post')
    const limits = spec.postLimits
    posted = { messages: posted.messages + 1, characters: posted.characters + text.length }
    if (posted.messages > limits.messages)
      flooded = `posted more than ${limits.messages} messages in one turn`
    else if (posted.characters > limits.characters)
      flooded = `posted more than ${limits.characters} characters in one turn`
    if (flooded !== undefined) throw new Error(flooded)
    send({ type: 'message', vm: id, json: text })
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
    deadline = performance.now() + spec.sliceMs
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
    if (flooded !== undefined) exit(flooded)
    else if (overran) exit(`held its thread for ${spec.sliceMs} ms`)
    else if (stopped()) exit('stopped')
    if (ended) return free()
    for (const message of unhandled.values()) send({ type: 'rejection', vm: id, message })
    unhandled.clear()
  }

  turn(() => {
    vm.evalCode(NO_CODE_GENERATION_SOURCE, 'vm-prelude.js').dispose()
    vm.evalCode(URL_SEARCH_PARAMS_SOURCE, 'vm-prelude.js').dispose()
    const runtime = vm.evalCode(`(function (host) {"use strict";\n${spec.runtime}\n})`, spec.name)
    try {
      vm.callFunction(runtime, vm.undefined, host).dispose()
    } finally {
      runtime.dispose()
      host.dispose()
    }
    vm.evalCode(MODULE_LOCKDOWN_SOURCE, 'lockdown.js').dispose()
    if (!receiver) throw new Error('the runtime did not call host.listen')
  })
  if (ended) return undefined

  return {
    deliver(json) {
      const listener = receiver
      if (!listener) return
      turn(() => {
        const text = vm.newString(json)
        try {
          vm.callFunction(listener, vm.undefined, text).dispose()
        } finally {
          text.dispose()
        }
      })
    },
    free: () => void (ended || free()),
  }
}
