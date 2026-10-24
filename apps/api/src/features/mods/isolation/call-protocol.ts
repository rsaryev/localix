/**
 * What a call into a mod's VM carries, and what the VM answers: the shapes both sides of the
 * channel agree on (the host's `stand-in.ts` and `mod-vm.ts`, the VM's `guest/`). Types only; the
 * host reads every answer as untrusted all the same.
 */

/** `$` as the host describes it: each namespace's methods, and its plain values. */
export type ApiShape = Record<string, Record<string, { fn: true } | { value: unknown }>>

/** What the VM's `next` mirrors of the host's: where the event came from, and the hook's time. */
export interface CallMeta {
  origin: unknown
  /** The dispatch's event, by name (`next.event`). */
  event?: string
  budget: { ms: number; remainingMs: number }
  error?: unknown
  called?: boolean
}

/** One run of a hook the module registered (`call`). */
export interface CallInput {
  hook: number
  call: number
  e: unknown
  shape: ApiShape
  next: CallMeta
}

/** What the VM answers a call: its value, the stream it yields, or that its matcher missed. */
export type CallReply = { value: unknown } | { stream: number } | { absent: true }

/** How the host answers a `next`: the result, or a stream of the call it keeps. */
export type NextReply = { value: unknown; trace?: unknown } | { stream: number }

/** One hook the module registered, as the VM describes it (`hook-specs.ts` reads it). */
export interface HookSpecWire {
  id: number
  event: string
  matcher?: unknown
  generator: boolean
  onError?: { id: number; generator: boolean }
}
