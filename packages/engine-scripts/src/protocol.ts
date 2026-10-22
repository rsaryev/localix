/**
 * What crosses between the host and a worker running a VM. A run's arguments, results and return
 * value, and a long-lived VM's messages, cross as JSON text: the VM parses and produces them
 * itself, so neither side ever shares a structured value with the other.
 */
import type { ScriptOutputItem } from '@localixai/agent/runtime'

export interface WorkerData {
  mode: 'run'
  code: string
  /** `name` is the tool's own name; `jsName` the identifier the script also reaches it by. */
  tools: { name: string; jsName: string }[]
  /** A compiled `quickjs.wasm`; a structured clone shares the compiled code with the worker. */
  wasm: object
  memoryLimitBytes: number
  /**
   * One Int32 the host sets before it terminates the worker. The VM polls it, because Bun's
   * `terminate()` cannot stop a thread spinning in wasm.
   */
  interrupt: SharedArrayBuffer
}

export type WorkerMessage =
  | { type: 'call'; id: number; name: string; args: string | undefined }
  | { type: 'output'; item: ScriptOutputItem }
  | { type: 'done'; ok: true; value: string | undefined }
  /** `error` is the JSON of `{ name?, message, stack? }`. */
  | { type: 'done'; ok: false; error: string }
  /** The VM failed outside the script's control, a wasm trap or an interrupt. */
  | { type: 'crash'; message: string }

/** A call's answer: the JSON result when `ok`, the error message otherwise. */
export interface HostMessage {
  type: 'result'
  id: number
  ok: boolean
  payload: string | undefined
}

/** A long-lived VM (`vm.ts`, `worker-vm.ts`): the runtime it evaluates first, and its limits. */
export interface VmWorkerData {
  mode: 'vm'
  runtime: string
  /** What stack traces name the runtime. */
  name: string
  wasm: object
  /** Compiled extensions, by the name their init function carries. */
  extensions: { name: string; wasm: object }[]
  memoryLimitBytes: number
  /** One turn — a delivered message and the promise jobs it starts — may run this long. */
  sliceMs: number
  /** As a run's: set by the host before it terminates the worker. */
  interrupt: SharedArrayBuffer
}

export type VmWorkerMessage =
  /** What the runtime posted (`host.post`). */
  | { type: 'message'; json: string }
  /** A promise of the VM's rejected with no handler by the end of a turn. */
  | { type: 'rejection'; message: string }
  /** The VM is done for: it held its thread past the turn's limit, or failed. */
  | { type: 'exit'; reason: string }

/** A message for the runtime's listener (`host.listen`). */
export interface VmHostMessage {
  type: 'deliver'
  json: string
}

const WORKER_TYPES = new Set(['call', 'output', 'done', 'crash'])
const VM_WORKER_TYPES = new Set(['message', 'rejection', 'exit'])

const typeOf = (value: unknown) =>
  typeof value === 'object' && value !== null ? (value as { type?: unknown }).type : undefined

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return WORKER_TYPES.has(typeOf(value) as string)
}

export function isHostMessage(value: unknown): value is HostMessage {
  return typeOf(value) === 'result'
}

export function isVmWorkerMessage(value: unknown): value is VmWorkerMessage {
  return VM_WORKER_TYPES.has(typeOf(value) as string)
}

export function isVmHostMessage(value: unknown): value is VmHostMessage {
  return typeOf(value) === 'deliver' && typeof (value as { json?: unknown }).json === 'string'
}
