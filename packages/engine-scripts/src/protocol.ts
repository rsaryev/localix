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

/** What one turn of a long-lived VM (`vm.ts`, `worker-vm.ts`) may post. */
export interface VmPostLimits {
  messages: number
  characters: number
}

/**
 * Generous for any runtime that answers what it is handed, and small enough that a VM posting in
 * a loop ends long before its queued messages swamp the host's thread.
 */
export const DEFAULT_VM_POST_LIMITS: VmPostLimits = {
  messages: 10_000,
  characters: 32 * 1024 * 1024,
}

/**
 * A thread's worker (`worker-vm.ts`): the compiled QuickJS and extensions each of its VMs
 * instantiates, with a heap of its own. A structured clone shares the compiled code.
 */
export interface VmThreadData {
  mode: 'vm'
  wasm: object
  /** Compiled extensions, by the name their init function carries. */
  extensions: { name: string; wasm: object }[]
}

/** One VM a thread starts: the runtime it evaluates first, and its limits. */
export interface VmSpec {
  runtime: string
  /** What stack traces name the runtime. */
  name: string
  memoryLimitBytes: number
  /** One turn — a delivered message and the promise jobs it starts — may run this long. */
  sliceMs: number
  /** What one turn may post (`host.post`): this many messages, this many characters in all. */
  postLimits: VmPostLimits
  /** One Int32 the host sets when it stops the VM: a turn running then is interrupted. */
  interrupt: SharedArrayBuffer
}

/** What a VM sends, by the id the host started it under. */
export type VmWorkerMessage =
  /** What the runtime posted (`host.post`). */
  | { type: 'message'; vm: number; json: string }
  /** A promise of the VM's rejected with no handler by the end of a turn. */
  | { type: 'rejection'; vm: number; message: string }
  /** The VM is done for: it held its thread past the turn's limit, or failed. The worker freed it. */
  | { type: 'exit'; vm: number; reason: string }

/** What the host asks of a thread's worker, for the VM of id `vm`. */
export type VmHostMessage =
  | { type: 'start'; vm: number; spec: VmSpec }
  /** A message for the runtime's listener (`host.listen`). */
  | { type: 'deliver'; vm: number; json: string }
  /** The host is done with the VM: the worker frees it. */
  | { type: 'stop'; vm: number }

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

const vmOf = (value: unknown) => (value as { vm?: unknown }).vm

export function isVmWorkerMessage(value: unknown): value is VmWorkerMessage {
  return VM_WORKER_TYPES.has(typeOf(value) as string) && typeof vmOf(value) === 'number'
}

export function isVmHostMessage(value: unknown): value is VmHostMessage {
  if (typeof vmOf(value) !== 'number') return false
  const type = typeOf(value)
  if (type === 'deliver') return typeof (value as { json?: unknown }).json === 'string'
  return type === 'start' || type === 'stop'
}
