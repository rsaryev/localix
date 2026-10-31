import { useSyncExternalStore } from 'react'

const pending = new Set<string>()
/** What the hook hands out: replaced only when membership changes, so its identity is stable. */
let pendingSnapshot: ReadonlySet<string> = new Set()
const NONE_PENDING: ReadonlySet<string> = new Set()
const departed = new Set<string>()
const unaccepted = new Set<string>()
let receiving = false
const listeners = new Set<() => void>()
const publish = () => {
  for (const listener of listeners) listener()
}

/** Window-local ownership: moving an owned terminal detaches its renderer without killing its PTY. */
export const workItemTransferState = {
  begin(id: string) {
    if (pending.has(id)) return false
    departed.delete(id)
    pending.add(id)
    pendingSnapshot = new Set(pending)
    publish()
    return true
  },
  finish(id: string, transferred = false) {
    if (pending.delete(id)) pendingSnapshot = new Set(pending)
    if (transferred) departed.add(id)
    publish()
  },
  departed: (id: string) => departed.has(id),
  attached: (id: string) => departed.delete(id),
  pending: (id: string) => pending.has(id),
  receiving: () => receiving,
  protectReceived: (id: string) => unaccepted.add(id),
  acceptReceived: (id: string) => unaccepted.delete(id),
  unaccepted: (id: string) => unaccepted.has(id),
  beginReceiving: () => {
    receiving = true
  },
  finishReceiving: () => {
    receiving = false
  },
  subscribe(this: void, listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function useWorkItemTransferPending(): ReadonlySet<string> {
  return useSyncExternalStore(
    workItemTransferState.subscribe,
    () => pendingSnapshot,
    () => NONE_PENDING,
  )
}
