/**
 * THE WORKER: one script in one fresh QuickJS VM, off the host's thread.
 *
 * QuickJS runs synchronously, so a script that only computes would block whatever thread it is on;
 * here it blocks this worker, and the host stays free to time it out, abort it, and terminate the
 * worker. The VM lives until then — it never decides on its own that it is finished.
 *
 * Importing this module starts the worker. A bundled host adds it as an entry of its own
 * (`SCRIPT_WORKER_ENTRY`) and passes the bundled file as the sandbox's `workerUrl`.
 */
import { parentPort, workerData } from 'node:worker_threads'

import { JSException, MAX_STACK_SIZE, QuickJS, type JSValueHandle } from 'quickjs-wasi'

import { PRELUDE_SOURCE } from './prelude'
import { isHostMessage, type WorkerData, type WorkerMessage } from './protocol'

/** Promise jobs run between two interrupt polls: `while (true) await null` is all jobs, few opcodes. */
const JOBS_PER_POLL = 50

function post(message: WorkerMessage): void {
  parentPort?.postMessage(message)
}

function crash(error: unknown): void {
  post({
    type: 'crash',
    message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
}

/**
 * QuickJS writes engine diagnostics to fd 1 and 2, which would land in the host's own stdout. They
 * are dropped, every byte reported as written so libc does not retry.
 */
function discardOutput(memory: { readonly buffer: ArrayBufferLike }) {
  return {
    fd_write(_fd: number, iovs: number, count: number, written: number): number {
      const view = new DataView(memory.buffer)
      let total = 0
      for (let index = 0; index < count; index++)
        total += view.getUint32(iovs + index * 8 + 4, true)
      view.setUint32(written, total, true)
      return 0
    },
  }
}

function describeException(error: JSException): string {
  const head = error.message ? `${error.name}: ${error.message}` : error.name
  const stack = error.stack?.trimEnd()
  return JSON.stringify({
    name: error.name,
    message: error.message,
    stack: stack ? `${head}\n${stack}` : head,
  })
}

async function main(data: WorkerData): Promise<void> {
  const interrupt = new Int32Array(data.interrupt)
  const interrupted = () => Atomics.load(interrupt, 0) !== 0
  const vm = await QuickJS.create({
    wasm: data.wasm as WebAssembly.Module,
    memoryLimit: data.memoryLimitBytes,
    // Deep recursion becomes a catchable RangeError instead of a wasm trap; 512 KiB fits a worker's stack.
    maxStackSize: MAX_STACK_SIZE,
    interruptHandler: interrupted,
    wasi: discardOutput,
  })

  // `executePendingJobs()` would run the queue to empty with no chance to interrupt, so jobs run one
  // at a time through the VM's exports (quickjs-wasi is pinned to an exact version for this).
  const exports = vm._getExports()
  let api: JSValueHandle
  let stalled: JSValueHandle
  let settle: JSValueHandle
  const drain = () => {
    let jobs = 0
    while (exports.qjs_is_job_pending()) {
      if (exports.qjs_execute_pending_job() < 0) throw new Error('Promise job failed')
      if (++jobs % JOBS_PER_POLL === 0 && interrupted()) throw new Error('Execution interrupted')
    }
    vm.callFunction(stalled, api).dispose()
  }

  // Called by the prelude with primitives only.
  const bridge = vm.newFunction('bridge', (kind, a, b, c) => {
    switch (kind.toString()) {
      case 'call':
        post({
          type: 'call',
          id: a.toNumber(),
          name: b.toString(),
          args: c === undefined || c.isUndefined ? undefined : c.toString(),
        })
        break
      case 'output':
        post({
          type: 'output',
          item:
            a.toString() === 'image'
              ? { type: 'image', data: b.toString(), mimeType: c.toString() }
              : { type: 'text', text: b.toString() },
        })
        break
      case 'done':
        if (a.toBoolean())
          post({
            type: 'done',
            ok: true,
            value: b === undefined || b.isUndefined ? undefined : b.toString(),
          })
        else post({ type: 'done', ok: false, error: b.toString() })
        break
    }
    return vm.undefined
  })

  try {
    // Lives as long as the VM, which dies with the worker.
    api = vm.withScope((scope) =>
      scope.escape(
        vm.callFunction(
          vm.evalCode(PRELUDE_SOURCE, 'prelude.js'),
          vm.undefined,
          bridge,
          vm.newString(JSON.stringify(data.tools)),
        ),
      ),
    )
    stalled = api.getProp('stalled')
    settle = api.getProp('settle')
    let script: JSValueHandle
    try {
      // The wrapper shares the script's first line, so reported line numbers match the script as written.
      script = vm.evalCode(`(async (tools, console) => {${data.code}\n})`, 'script.js')
    } catch (error) {
      if (!(error instanceof JSException)) throw error
      post({ type: 'done', ok: false, error: describeException(error) })
      return
    }
    const run = api.getProp('run')
    vm.callFunction(run, api, script).dispose()
    run.dispose()
    script.dispose()
    drain()
  } catch (error) {
    crash(error)
    return
  }

  parentPort?.on('message', (message: unknown) => {
    if (!isHostMessage(message)) return
    try {
      vm.withScope(() => {
        vm.callFunction(
          settle,
          api,
          vm.newNumber(message.id),
          message.ok ? vm.true : vm.false,
          message.payload === undefined ? vm.undefined : vm.newString(message.payload),
        )
      })
      drain()
    } catch (error) {
      crash(error)
    }
  })
}

if (parentPort) main(workerData as WorkerData).catch(crash)
