import { useSyncExternalStore } from 'react'

const pending = new Set<string>()
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
    publish()
    return true
  },
  finish(id: string, transferred = false) {
    pending.delete(id)
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
  // A primitive snapshot stays stable until membership changes.
  const key = useSyncExternalStore(
    workItemTransferState.subscribe,
    () => JSON.stringify([...pending]),
    () => '[]',
  )
  return new Set(JSON.parse(key) as string[])
}
