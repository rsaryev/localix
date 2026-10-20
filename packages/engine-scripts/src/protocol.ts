/**
 * What crosses between the host and the worker that runs one script. Arguments, results and the
 * return value cross as JSON text: the VM parses and produces them itself, so neither side ever
 * shares a structured value with the other.
 */
import type { ScriptOutputItem } from '@localixai/agent/runtime'

export interface WorkerData {
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

const WORKER_TYPES = new Set(['call', 'output', 'done', 'crash'])

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    WORKER_TYPES.has((value as { type?: unknown }).type as string)
  )
}

export function isHostMessage(value: unknown): value is HostMessage {
  return (
    typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'result'
  )
}
