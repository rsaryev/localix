/**
 * THE WORKER: one script in one fresh QuickJS VM, off the host's thread.
 *
 * QuickJS runs synchronously, so a script that only computes would block whatever thread it is on;
 * here it blocks this worker, and the host stays free to time it out, abort it, and terminate the
 * worker. The VM lives until then — it never decides on its own that it is finished.
 *
 * Importing this module starts the worker. A bundled host bundles it from the package's `./worker`
 * export, the same build the host itself resolves, and passes the file as the sandbox's `workerUrl`.
 */
import { parentPort, workerData } from 'node:worker_threads'

import { JSException, MAX_STACK_SIZE, QuickJS, type JSValueHandle } from 'quickjs-wasi'

import { PRELUDE_SOURCE } from './prelude'
import { isHostMessage, type WorkerData, type WorkerMessage } from './protocol'

/** Promise jobs run between two interrupt checks: `while (true) await null` is all jobs, few opcodes. */
const JOBS_BETWEEN_CHECKS = 50

const send = (message: WorkerMessage) => parentPort?.postMessage(message)

function reportCrash(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  send({ type: 'crash', message })
}

/**
 * WASI for the VM: QuickJS prints engine diagnostics to fd 1 and 2, which would land in the host's
 * own stdout. Every write is swallowed and reported as complete, so libc does not retry it.
 */
function silentStdio(memory: { readonly buffer: ArrayBufferLike }) {
  return {
    fd_write(_fd: number, iovecs: number, iovecCount: number, writtenOut: number): number {
      const view = new DataView(memory.buffer)
      let bytes = 0
      // Each iovec is { buf: u32, len: u32 }; only the lengths matter here.
      for (let i = 0; i < iovecCount; i++) bytes += view.getUint32(iovecs + 8 * i + 4, true)
      view.setUint32(writtenOut, bytes, true)
      return 0
    },
  }
}

/** A script that did not compile, in the shape the host decodes as a script error. */
function compileError(error: JSException): string {
  const title = error.message ? `${error.name}: ${error.message}` : error.name
  const frames = error.stack?.trimEnd()
  return JSON.stringify({
    name: error.name,
    message: error.message,
    stack: frames ? `${title}\n${frames}` : title,
  })
}

/** The prelude hands the bridge primitives only; anything else is refused, never converted. */
function stringOf(handle: JSValueHandle | undefined): string {
  // Converting an object would run the script's own `toString`.
  if (!handle?.isString) throw new TypeError('The script sandbox received a non-string value')
  return handle.toString()
}

const maybeString = (handle: JSValueHandle | undefined) =>
  handle === undefined || handle.isUndefined ? undefined : stringOf(handle)

/** Turns one bridge call from the prelude into the message the host reads. */
function toMessage(
  kind: JSValueHandle,
  a: JSValueHandle,
  b?: JSValueHandle,
  c?: JSValueHandle,
): WorkerMessage | undefined {
  const what = stringOf(kind)
  if (what === 'call') {
    if (!a.isNumber) throw new TypeError('The script sandbox received a non-numeric call id')
    return { type: 'call', id: a.toNumber(), name: stringOf(b), args: maybeString(c) }
  }
  if (what === 'output') {
    const item =
      stringOf(a) === 'image'
        ? { type: 'image' as const, data: stringOf(b), mimeType: stringOf(c) }
        : { type: 'text' as const, text: stringOf(b) }
    return { type: 'output', item }
  }
  if (what === 'done') {
    return a.toBoolean()
      ? { type: 'done', ok: true, value: maybeString(b) }
      : { type: 'done', ok: false, error: stringOf(b) }
  }
  return undefined
}

async function start(data: WorkerData): Promise<void> {
  const flag = new Int32Array(data.interrupt)
  const stopRequested = () => Atomics.load(flag, 0) !== 0
  const vm = await QuickJS.create({
    wasm: data.wasm as WebAssembly.Module,
    memoryLimit: data.memoryLimitBytes,
    // Deep recursion becomes a catchable RangeError instead of a wasm trap; 512 KiB fits a worker's stack.
    maxStackSize: MAX_STACK_SIZE,
    interruptHandler: stopRequested,
    wasi: silentStdio,
  })

  const bridge = vm.newFunction('bridge', (kind, a, b, c) => {
    try {
      const message = toMessage(kind, a, b, c)
      if (message) send(message)
    } catch (error) {
      // Ends the run on the host; thrown into the VM instead, the script could catch it.
      reportCrash(error)
    }
    return vm.undefined
  })

  // The prelude's API lives as long as the VM, which dies with the worker.
  const api = vm.withScope((scope) => {
    const factory = vm.evalCode(PRELUDE_SOURCE, 'prelude.js')
    const toolsJson = vm.newString(JSON.stringify(data.tools))
    return scope.escape(vm.callFunction(factory, vm.undefined, bridge, toolsJson))
  })
  const stalledFn = api.getProp('stalled')
  const settleFn = api.getProp('settle')

  // `executePendingJobs()` would run the whole queue with no chance to interrupt, so jobs run one
  // at a time through the VM's exports (quickjs-wasi is pinned to an exact version for this).
  const raw = vm._getExports()
  const runJobs = () => {
    for (let count = 1; raw.qjs_is_job_pending(); count++) {
      if (raw.qjs_execute_pending_job() < 0) throw new Error('Promise job failed')
      if (count % JOBS_BETWEEN_CHECKS === 0 && stopRequested()) {
        throw new Error('Execution interrupted')
      }
    }
    vm.callFunction(stalledFn, api).dispose()
  }

  let script: JSValueHandle
  try {
    // The wrapper shares the script's first line, so reported line numbers match the script as written.
    script = vm.evalCode(`(async (tools, console) => {${data.code}\n})`, 'script.js')
  } catch (error) {
    if (!(error instanceof JSException)) throw error
    send({ type: 'done', ok: false, error: compileError(error) })
    return
  }
  const runFn = api.getProp('run')
  vm.callFunction(runFn, api, script).dispose()
  runFn.dispose()
  script.dispose()
  runJobs()

  parentPort?.on('message', (message: unknown) => {
    if (!isHostMessage(message)) return
    try {
      vm.withScope(() => {
        const payload = message.payload === undefined ? vm.undefined : vm.newString(message.payload)
        const ok = message.ok ? vm.true : vm.false
        vm.callFunction(settleFn, api, vm.newNumber(message.id), ok, payload)
      })
      runJobs()
    } catch (error) {
      reportCrash(error)
    }
  })
}

if (parentPort) start(workerData as WorkerData).catch(reportCrash)
