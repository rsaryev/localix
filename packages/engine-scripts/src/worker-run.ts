/**
 * A RUN in the worker (`worker.ts`): one script in one fresh QuickJS VM, off the host's thread.
 *
 * QuickJS runs synchronously, so a script that only computes would block whatever thread it is on;
 * here it blocks this worker, and the host stays free to time it out, abort it, and terminate the
 * worker. The VM lives until then — it never decides on its own that it is finished.
 */
import { parentPort } from 'node:worker_threads'

import { JSException, type JSValueHandle } from 'quickjs-wasi'

import { PRELUDE_SOURCE } from './prelude'
import { isHostMessage, type WorkerData, type WorkerMessage } from './protocol'
import { createQuickJs, runPendingJobs } from './quickjs'

const send = (message: WorkerMessage) => parentPort?.postMessage(message)

export function reportCrash(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  send({ type: 'crash', message })
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

export async function startRun(data: WorkerData): Promise<void> {
  const flag = new Int32Array(data.interrupt)
  const stopRequested = () => Atomics.load(flag, 0) !== 0
  const vm = await createQuickJs({
    wasm: data.wasm,
    memoryLimitBytes: data.memoryLimitBytes,
    interrupted: stopRequested,
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

  const runJobs = () => {
    runPendingJobs(vm, stopRequested)
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
