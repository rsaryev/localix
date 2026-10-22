/**
 * What every worker does with QuickJS: create a VM that prints nothing to the host's stdio, run
 * its promise jobs one at a time so an interrupt can stop a loop of them, and read a guest value
 * as text without running the guest's code.
 */
import { MAX_STACK_SIZE, QuickJS, type JSValueHandle, type QuickJSOptions } from 'quickjs-wasi'

/** Promise jobs run between two interrupt checks: `while (true) await null` is all jobs, few opcodes. */
const JOBS_BETWEEN_CHECKS = 50

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

export function createQuickJs(input: {
  wasm: object
  memoryLimitBytes: number
  interrupted: () => boolean
  extensions?: QuickJSOptions['extensions']
  onUnhandledRejection?: QuickJSOptions['onUnhandledRejection']
}): Promise<QuickJS> {
  return QuickJS.create({
    wasm: input.wasm as WebAssembly.Module,
    memoryLimit: input.memoryLimitBytes,
    // Deep recursion becomes a catchable RangeError instead of a wasm trap; 512 KiB fits a worker's stack.
    maxStackSize: MAX_STACK_SIZE,
    interruptHandler: input.interrupted,
    wasi: silentStdio,
    ...(input.extensions ? { extensions: input.extensions } : {}),
    ...(input.onUnhandledRejection ? { onUnhandledRejection: input.onUnhandledRejection } : {}),
  })
}

/**
 * Runs the VM's pending promise jobs. `executePendingJobs()` would run the whole queue with no
 * chance to interrupt, so jobs run one at a time through the VM's exports (quickjs-wasi is pinned
 * to an exact version for this). A job that fails throws its exception's text.
 */
export function runPendingJobs(vm: QuickJS, interrupted: () => boolean): void {
  const raw = vm._getExports()
  for (let count = 1; raw.qjs_is_job_pending(); count++) {
    if (raw.qjs_execute_pending_job() < 0) {
      const exception = vm.getException()
      try {
        throw new Error(describeValue(exception))
      } finally {
        exception.dispose()
      }
    }
    if (count % JOBS_BETWEEN_CHECKS === 0 && interrupted()) throw new Error('Execution interrupted')
  }
}

/**
 * A guest value as text, read without running guest code: a string as it is, an error as
 * `Name: message` from its own data properties, a primitive by its value.
 */
export function describeValue(value: JSValueHandle): string {
  if (value.isString) return value.toString()
  if (value.isNumber) return String(value.toNumber())
  if (value.isBool) return String(value.toBoolean())
  if (!value.isError || value.isProxy) return 'a value that is not an Error'
  const field = (key: string) => {
    const descriptor = value.getOwnPropertyDescriptor(key)
    const read = descriptor?.value
    const text = read?.isString ? read.toString() : undefined
    descriptor?.value?.dispose()
    descriptor?.get?.dispose()
    descriptor?.set?.dispose()
    return text
  }
  const message = field('message') ?? ''
  const name = field('name')
  return name ? `${name}: ${message}` : message
}
