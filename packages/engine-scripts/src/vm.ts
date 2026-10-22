/**
 * THE HOST SIDE of a long-lived VM (`worker-vm.ts`): a QuickJS VM in a worker thread of its own
 * that runs a runtime the host hands it, and exchanges JSON text with it until the host stops it.
 * What the messages mean — calls, functions lent by id, streams — is the runtime's and its host's
 * own; this side carries text, keeps the limits, and says when the VM is done for.
 *
 * The limits: the VM's heap (`memoryLimitBytes`), and its turn (`sliceMs`) — a delivered message
 * and the promise jobs it starts — past which the VM is interrupted and ends. Messages sent before
 * the worker is up wait for it. `onExit` is called once, when the VM ends by itself; never after
 * `stop()`. Nothing the VM sends is trusted: it is text, for the caller to parse and check.
 */
import { Worker } from 'node:worker_threads'

import { SCRIPT_EXTENSION_FILES } from './assets'
import { isVmWorkerMessage, type VmHostMessage, type VmWorkerData } from './protocol'
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

export interface ScriptVms {
  start(input: ScriptVmStart): ScriptVm
}

const EXTENSIONS = Object.keys(SCRIPT_EXTENSION_FILES) as ExtensionName[]

export function createScriptVms(options: ScriptSandboxOptions = {}): ScriptVms {
  return {
    start(input) {
      const interrupt = new SharedArrayBuffer(4)
      const waiting: string[] = []
      let worker: Worker | undefined
      let ended = false

      const end = (reason?: string) => {
        if (ended) return
        ended = true
        waiting.length = 0
        Atomics.store(new Int32Array(interrupt), 0, 1)
        void worker?.terminate().catch(() => undefined)
        if (reason !== undefined) input.onExit(reason)
      }
      const deliver = (json: string) =>
        worker?.postMessage({ type: 'deliver', json } as VmHostMessage)

      const boot = async () => {
        const files = resolveFiles(options)
        const [wasm, ...extensions] = await Promise.all([
          loadWasm(files.wasm),
          ...EXTENSIONS.map((name) => loadWasm(files.extension(name))),
        ])
        if (ended) return
        const data: VmWorkerData = {
          mode: 'vm',
          runtime: input.runtime,
          name: input.name,
          wasm: wasm!,
          // An extension's init function is named after it, with `_` for `-`.
          extensions: EXTENSIONS.map((name, index) => ({
            name: name.replaceAll('-', '_'),
            wasm: extensions[index]!,
          })),
          memoryLimitBytes:
            input.memoryLimitBytes ?? options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT,
          sliceMs: input.sliceMs,
          interrupt,
        }
        worker = new Worker(files.worker, { workerData: data })
        worker.on('message', (message: unknown) => {
          if (ended || !isVmWorkerMessage(message)) return
          if (message.type === 'message') input.onMessage(message.json)
          else if (message.type === 'rejection') input.onUnhandledRejection?.(message.message)
          else end(message.reason)
        })
        worker.on('error', (error) => end(`crashed: ${messageOf(error)}`))
        worker.on('exit', () => end('exited'))
        for (const json of waiting.splice(0)) deliver(json)
      }
      boot().catch((error: unknown) => end(`could not load QuickJS: ${messageOf(error)}`))

      return {
        send(json) {
          if (ended) return
          if (worker) deliver(json)
          else waiting.push(json)
        },
        stop: () => end(),
      }
    },
  }
}
