/**
 * THE HOST SIDE of long-lived VMs (`worker-vm.ts`): QuickJS VMs, each running a runtime the host
 * hands it and exchanging JSON text with it until the host stops it. VMs start on a THREAD: the
 * VMs of one thread run in one worker, which starts with the first of them and is terminated with
 * the last (a later VM starts it again). Each VM keeps a QuickJS instance and a heap of its own;
 * a thread shares only its time, so a host gives a thread to VMs that may wait on one another (a
 * conversation's mods) and a thread of their own to those that may not. What the messages mean —
 * calls, functions lent by id, streams — is the runtime's and its host's own; this side carries
 * text, keeps the limits, and says when a VM is done for.
 *
 * The limits: the VM's heap (`memoryLimitBytes`), its turn (`sliceMs`) — a delivered message
 * and the promise jobs it starts — past which the VM is interrupted and ends, and what one turn
 * may post (`postLimits`), past which it ends too: the turn's time alone lets a posting loop queue
 * millions of messages the host would then parse on its own thread. Messages sent before
 * the worker is up wait for it. `onExit` is called once, when the VM ends by itself — its own
 * failure, or its worker's; never after `stop()`. Nothing the VM sends is trusted: it is text, for
 * the caller to parse and check.
 */
import { Worker } from 'node:worker_threads'

import { SCRIPT_EXTENSION_FILES } from './assets'
import {
  DEFAULT_VM_POST_LIMITS,
  isVmWorkerMessage,
  type VmHostMessage,
  type VmPostLimits,
  type VmThreadData,
} from './protocol'
import {
  DEFAULT_MEMORY_LIMIT,
  loadWasm,
  messageOf,
  resolveFiles,
  type ExtensionName,
  type ScriptSandboxOptions,
} from './runtime-files'

export interface ScriptVmStart {
  /** JavaScript evaluated as the body of `function (host) { … }` before anything else. */
  runtime: string
  /** What stack traces name the runtime. */
  name: string
  /** How long one turn may hold the VM's thread. */
  sliceMs: number
  /** The VM's heap; the sandbox's own default when absent. */
  memoryLimitBytes?: number
  /** What one turn may post before the VM is ended; `DEFAULT_VM_POST_LIMITS` when absent. */
  postLimits?: VmPostLimits
  /** Each message the runtime posted, as it posted it. */
  onMessage(json: string): void
  /** A rejection the VM's code left unhandled at the end of a turn, as text. */
  onUnhandledRejection?(message: string): void
  /** The VM ended by itself, and why: it held its thread, crashed, or its worker exited. */
  onExit(reason: string): void
}

export interface ScriptVm {
  /** Hands `json` to the runtime's listener; dropped once the VM ended. */
  send(json: string): void
  /** Ends the VM; `onExit` is not called. */
  stop(): void
}

/** VMs that share a worker. */
export interface ScriptVmThread {
  start(input: ScriptVmStart): ScriptVm
}

export interface ScriptVms {
  /** A new thread, with no worker until its first VM starts. */
  thread(): ScriptVmThread
}

const EXTENSIONS = Object.keys(SCRIPT_EXTENSION_FILES) as ExtensionName[]

/** A VM of a worker, as its messages reach the host. */
interface Member {
  input: ScriptVmStart
  /** Ends it, and `onExit` hears why when given a reason. */
  end(reason?: string): void
}

/** One worker of a thread and the VMs in it, by id; it is terminated once none is left. */
function startWorker(options: ScriptSandboxOptions, left: () => void) {
  const members = new Map<number, Member>()
  const waiting: VmHostMessage[] = []
  let worker: Worker | undefined
  let over = false

  const post = (message: VmHostMessage) => {
    if (worker) worker.postMessage(message)
    else waiting.push(message)
  }
  /** The worker is gone, or about to be: the VMs still in it end with `reason`. */
  const close = (reason?: string) => {
    if (over) return
    over = true
    left()
    waiting.length = 0
    const ending = [...members.values()]
    members.clear()
    for (const member of ending) member.end(reason)
    void worker?.terminate().catch(() => undefined)
    worker = undefined
  }

  const boot = async () => {
    const files = resolveFiles(options)
    const [wasm, ...extensions] = await Promise.all([
      loadWasm(files.wasm),
      ...EXTENSIONS.map((name) => loadWasm(files.extension(name))),
    ])
    if (over) return
    const data: VmThreadData = {
      mode: 'vm',
      wasm: wasm!,
      // An extension's init function is named after it, with `_` for `-`.
      extensions: EXTENSIONS.map((name, index) => ({
        name: name.replaceAll('-', '_'),
        wasm: extensions[index]!,
      })),
    }
    const started = new Worker(files.worker, { workerData: data })
    worker = started
    started.on('message', (message: unknown) => {
      if (!isVmWorkerMessage(message)) return
      const member = members.get(message.vm)
      if (!member) return
      if (message.type === 'message') member.input.onMessage(message.json)
      else if (message.type === 'rejection') member.input.onUnhandledRejection?.(message.message)
      else member.end(message.reason)
    })
    started.on('error', (error) => close(`crashed: ${messageOf(error)}`))
    started.on('exit', () => close('exited'))
    for (const message of waiting.splice(0)) started.postMessage(message)
  }
  boot().catch((error: unknown) => close(`could not load QuickJS: ${messageOf(error)}`))

  let ids = 0
  return {
    start(input: ScriptVmStart): ScriptVm {
      const id = (ids += 1)
      const interrupt = new SharedArrayBuffer(4)
      let ended = false
      const member: Member = {
        input,
        end(reason) {
          if (ended) return
          ended = true
          // A turn running now stops at its next check; the worker frees the VM.
          Atomics.store(new Int32Array(interrupt), 0, 1)
          members.delete(id)
          if (!over) post({ type: 'stop', vm: id })
          if (reason !== undefined) input.onExit(reason)
          if (members.size === 0) close()
        },
      }
      members.set(id, member)
      post({
        type: 'start',
        vm: id,
        spec: {
          runtime: input.runtime,
          name: input.name,
          memoryLimitBytes:
            input.memoryLimitBytes ?? options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT,
          sliceMs: input.sliceMs,
          postLimits: input.postLimits ?? DEFAULT_VM_POST_LIMITS,
          interrupt,
        },
      })
      return {
        send: (json) => void (ended || post({ type: 'deliver', vm: id, json })),
        stop: () => member.end(),
      }
    },
  }
}

export function createScriptVms(options: ScriptSandboxOptions = {}): ScriptVms {
  return {
    thread() {
      let current: ReturnType<typeof startWorker> | undefined
      return {
        start(input) {
          const worker = (current ??= startWorker(options, () => {
            if (current === worker) current = undefined
          }))
          return worker.start(input)
        },
      }
    },
  }
}
