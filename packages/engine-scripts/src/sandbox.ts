/**
 * THE HOST SIDE of a script: its tools, deadline, abort and output, and the decoding of whatever
 * the worker reports. Each run gets a fresh worker and VM, terminated once the run has its result,
 * so nothing a script does — a spinning loop included — outlives it or reaches the next one.
 *
 * The first terminal event decides the run: the script's `done`, a crash, the deadline, the
 * caller's abort, the worker dying, or the script passing a limit the host counts itself
 * (`budget.ts`). The run settles at once; calls still in flight are aborted, the worker is
 * terminated in the background, and later events are ignored.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import type {
  ScriptOutputItem,
  ScriptRunRequest,
  ScriptRunResult,
  ScriptSandbox,
} from '@localixai/agent/runtime'

import { SCRIPT_WASM_FILE, SCRIPT_WORKER_FILE } from './assets'
import { createCallSlots, createRunBudget } from './budget'
import { renderDeclarations, toIdentifier } from './declarations'
import { isWorkerMessage, type HostMessage, type WorkerData, type WorkerMessage } from './protocol'

export interface ScriptSandboxOptions {
  /** `quickjs.wasm` on disk. Default: the installed `quickjs-wasi` package's file. */
  wasmPath?: string
  /** The worker entry. Default: this package's own; a bundled host passes its bundled copy. */
  workerUrl?: string | URL
  /** The VM's heap; an allocation past it fails in the script as `InternalError: out of memory`. */
  memoryLimitBytes?: number
}

const DEFAULT_MEMORY_LIMIT = 256 * 1024 * 1024

/**
 * Where a BUNDLED host keeps the worker and the VM: both beside its bundle in `dir`. Undefined when
 * they are not there — a host running from source, where the defaults already resolve.
 */
export function bundledScriptSandboxOptions(dir: string): ScriptSandboxOptions | undefined {
  const workerPath = join(dir, SCRIPT_WORKER_FILE)
  const wasmPath = join(dir, SCRIPT_WASM_FILE)
  if (!existsSync(workerPath) || !existsSync(wasmPath)) return undefined
  return { workerUrl: pathToFileURL(workerPath), wasmPath }
}

const compiled = new Map<string, Promise<object>>()

/** Compiled once per path; a failed load is tried again by the next run. */
function loadWasm(path: string): Promise<object> {
  let module = compiled.get(path)
  if (!module) {
    module = readFile(path).then((bytes) => WebAssembly.compile(bytes))
    module.catch(() => compiled.delete(path))
    compiled.set(path, module)
  }
  return module
}

function defaultWorkerUrl(): URL {
  // `.ts` from source (tests, the dev server), `.js` from `dist`.
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Text the worker sent that should be JSON and is not: a script that patched the built-ins it is encoded with. */
function parseJson(json: string, what: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    throw new Error(
      `The script's ${what} did not decode; it may have patched a built-in such as a toJSON.`,
    )
  }
}

function scriptError(json: string): { message: string; stack?: string } {
  const parsed = parseJson(json, 'error')
  const { message, stack } = (
    typeof parsed === 'object' && parsed !== null ? parsed : {}
  ) as Record<string, unknown>
  return {
    message: typeof message === 'string' ? message : 'The script failed',
    ...(typeof stack === 'string' ? { stack } : {}),
  }
}

/** setTimeout fires at once past this; a longer deadline is no deadline in practice. */
const MAX_TIMER_MS = 2_147_483_647

export function createScriptSandbox(options: ScriptSandboxOptions = {}): ScriptSandbox {
  const memoryLimitBytes = options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT
  // Resolved on the first run, not here: a host missing the files fails codemode, not its boot.
  const wasmPath = () =>
    options.wasmPath ?? createRequire(import.meta.url).resolve('quickjs-wasi/quickjs.wasm')
  const workerUrl = () => options.workerUrl ?? defaultWorkerUrl()

  return {
    declare: renderDeclarations,
    run(request: ScriptRunRequest): Promise<ScriptRunResult> {
      const output: ScriptOutputItem[] = []
      const calls = new Map<number, AbortController>()
      const tools = new Map(request.tools.map((tool) => [tool.name, tool]))
      const budget = createRunBudget()
      const slots = createCallSlots()
      const interrupt = new SharedArrayBuffer(4)
      let worker: Worker | undefined
      let finished = false
      let resolve!: (result: ScriptRunResult) => void
      const result = new Promise<ScriptRunResult>((settle) => (resolve = settle))

      const finish = (
        outcome: { value: unknown } | { error: { message: string; stack?: string } },
      ) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        request.signal?.removeEventListener('abort', onAbort)
        for (const controller of calls.values()) controller.abort()
        calls.clear()
        slots.close()
        Atomics.store(new Int32Array(interrupt), 0, 1)
        // Settled now: a VM inside a long native operation takes time to stop, and nothing it
        // does any more can reach the result.
        void worker?.terminate().catch(() => undefined)
        resolve(
          'error' in outcome
            ? { ok: false, error: outcome.error, output }
            : { ok: true, value: outcome.value, output },
        )
      }
      const fail = (message: string) => finish({ error: { message } })
      const onAbort = () => {
        const reason: unknown = request.signal?.reason
        fail(
          reason instanceof Error && reason.name !== 'AbortError'
            ? reason.message
            : 'The script was cancelled',
        )
      }
      const timer =
        Number.isFinite(request.timeoutMs) && request.timeoutMs < MAX_TIMER_MS
          ? setTimeout(
              () => fail(`The script timed out after ${request.timeoutMs} ms`),
              Math.max(0, request.timeoutMs),
            )
          : undefined
      if (request.signal?.aborted) onAbort()
      else request.signal?.addEventListener('abort', onAbort, { once: true })

      const reply = (message: HostMessage) => {
        if (!finished) worker?.postMessage(message)
      }
      const call = async ({ id, name, args }: Extract<WorkerMessage, { type: 'call' }>) => {
        const controller = new AbortController()
        calls.set(id, controller)
        await slots.acquire()
        if (controller.signal.aborted) return
        let message: HostMessage
        try {
          const tool = tools.get(name)
          if (!tool) throw new Error(`Unknown tool "${name}"`)
          const value = await tool.execute(
            args === undefined ? undefined : parseJson(args, 'call arguments'),
            controller.signal,
          )
          message = {
            type: 'result',
            id,
            ok: true,
            payload: value === undefined ? undefined : JSON.stringify(value),
          }
        } catch (error) {
          message = { type: 'result', id, ok: false, payload: messageOf(error) }
        } finally {
          slots.release()
        }
        if (calls.delete(id)) reply(message)
      }
      const receive = (message: unknown) => {
        if (finished) return
        try {
          if (!isWorkerMessage(message)) return
          switch (message.type) {
            case 'output':
              output.push(budget.output(message.item))
              break
            case 'call':
              budget.call(message.args)
              void call(message)
              break
            case 'done':
              if (message.ok) {
                budget.returnValue(message.value)
                finish({
                  value:
                    message.value === undefined
                      ? undefined
                      : parseJson(message.value, 'return value'),
                })
              } else finish({ error: scriptError(message.error) })
              break
            case 'crash':
              fail(message.message)
              break
          }
        } catch (error) {
          fail(messageOf(error))
        }
      }

      if (!finished) {
        let paths: { wasm: string; worker: string | URL }
        try {
          paths = { wasm: wasmPath(), worker: workerUrl() }
        } catch (error) {
          fail(`The script sandbox could not find QuickJS: ${messageOf(error)}`)
          return result
        }
        loadWasm(paths.wasm).then(
          (wasm) => {
            if (finished) return
            const data: WorkerData = {
              code: request.code,
              tools: request.tools.map((tool) => ({
                name: tool.name,
                jsName: toIdentifier(tool.name),
              })),
              wasm,
              memoryLimitBytes,
              interrupt,
            }
            try {
              worker = new Worker(paths.worker, { workerData: data })
            } catch (error) {
              fail(`The script sandbox did not start: ${messageOf(error)}`)
              return
            }
            worker.on('message', receive)
            worker.on('error', (error) => fail(`The script sandbox failed: ${messageOf(error)}`))
            worker.on('exit', (code) =>
              fail(`The script sandbox exited (code ${code}) before the script finished`),
            )
          },
          (error: unknown) =>
            fail(`The script sandbox could not load QuickJS: ${messageOf(error)}`),
        )
      }
      return result
    },
  }
}
