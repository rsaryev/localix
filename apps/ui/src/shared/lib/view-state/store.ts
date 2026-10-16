import type {
  ViewStateAddress,
  ViewStateSnapshot,
  ViewStateWrite,
  ViewStateValues,
} from '@localixai/api/client'
import { backendClient } from '@/shared/api/client'
import { resourceSync } from '@/shared/api/resourceSync'
import { registerQuitFlush } from '@/shared/lib/quitFlush'

export interface ViewStateView {
  value: ViewStateValues[keyof ViewStateValues] | null
  revision: number
  loaded: boolean
  pending: boolean
  conflict: ViewStateSnapshot | null
  error: string | null
}
interface Entry {
  address: ViewStateAddress
  remote: ViewStateSnapshot
  view: ViewStateView
  listeners: Set<() => void>
  dirty: boolean
  generation: number
  timer?: ReturnType<typeof setTimeout>
  flight?: Promise<void>
  read?: Promise<ViewStateSnapshot>
  retained: number
  stop?: () => void
}
const entries = new Map<string, Entry>()
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const idOf = (address: ViewStateAddress) => JSON.stringify([address.kind, address.key])
function publish(entry: Entry, next: Partial<ViewStateView>) {
  entry.view = { ...entry.view, ...next }
  for (const listener of entry.listeners) listener()
}
function schedule(entry: Entry) {
  clearTimeout(entry.timer)
  entry.timer = setTimeout(
    () => {
      void flush(entry)
    },
    entry.address.kind === 'draft' ? 600 : 0,
  )
}
function applyRead(entry: Entry, remote: ViewStateSnapshot) {
  if (remote.revision < entry.remote.revision) return
  if (
    entry.dirty &&
    !same(remote.value, entry.remote.value) &&
    !same(remote.value, entry.view.value)
  ) {
    entry.remote = remote
    publish(entry, { revision: remote.revision, loaded: true, conflict: remote, error: null })
    if (entry.address.kind === 'surface') keepLocal(entry)
    return
  }
  entry.remote = remote
  if (!entry.dirty)
    publish(entry, { value: remote.value, revision: remote.revision, loaded: true, error: null })
  else {
    publish(entry, { revision: remote.revision, loaded: true, error: null })
    schedule(entry)
  }
}
async function read(entry: Entry, signal?: AbortSignal) {
  if (!entry.read)
    entry.read = backendClient.getViewState(entry.address, signal).finally(() => {
      entry.read = undefined
    })
  return entry.read
}
async function flush(entry: Entry): Promise<void> {
  clearTimeout(entry.timer)
  if (entry.flight) {
    await entry.flight
    if (entry.dirty && !entry.view.conflict && !entry.view.error) return flush(entry)
    return
  }
  if (!entry.dirty || entry.view.conflict) return
  entry.flight = (async () => {
    try {
      if (!entry.view.loaded) applyRead(entry, await read(entry))
      if (entry.view.conflict) return
      const generation = entry.generation
      const value = entry.view.value
      const result = await backendClient.writeViewState({
        ...entry.address,
        value,
        expectedRevision: entry.remote.revision,
      } as ViewStateWrite)
      const observed = entry.remote
      if (result.state.revision >= observed.revision) entry.remote = result.state
      if (
        result.accepted &&
        observed.revision > result.state.revision &&
        !same(observed.value, value)
      ) {
        publish(entry, { conflict: observed })
        return
      }
      if (!result.accepted) {
        publish(entry, { conflict: result.state })
        if (entry.address.kind === 'surface') keepLocal(entry)
        return
      }
      if (entry.generation === generation) {
        entry.dirty = false
        publish(entry, {
          value: result.state.value,
          revision: result.state.revision,
          pending: false,
          conflict: null,
          error: null,
        })
      }
    } catch (error) {
      publish(entry, {
        error: error instanceof Error ? error.message : 'Could not save this draft',
      })
    }
  })().finally(() => {
    entry.flight = undefined
  })
  await entry.flight
  if (entry.dirty && !entry.view.conflict && !entry.view.error) schedule(entry)
}
function keepLocal(entry: Entry) {
  publish(entry, { conflict: null, error: null })
  entry.dirty = true
  schedule(entry)
}
function ensure(address: ViewStateAddress): Entry {
  const id = idOf(address)
  let entry = entries.get(id)
  if (!entry) {
    entry = {
      address,
      remote: { ...address, revision: 0, value: null, updatedAt: null },
      view: {
        value: null,
        revision: 0,
        loaded: false,
        pending: false,
        conflict: null,
        error: null,
      },
      listeners: new Set(),
      dirty: false,
      generation: 0,
      retained: 0,
    }
    entries.set(id, entry)
    registerQuitFlush(`view-state:${id}`, () => flush(entry!))
  }
  return entry
}
export const viewStateStore = {
  snapshot(address: ViewStateAddress) {
    return ensure(address).view
  },
  subscribe(address: ViewStateAddress, listener: () => void) {
    const entry = ensure(address)
    entry.listeners.add(listener)
    entry.retained++
    if (!entry.stop)
      entry.stop = resourceSync.register('view-state', {
        read: (signal) => read(entry, signal),
        apply: (snapshot) => applyRead(entry, snapshot),
        onError: (error) =>
          publish(entry, {
            error: error instanceof Error ? error.message : 'Could not load saved state',
          }),
      })
    // The resource scheduler handles reconnects; a standalone caller can hydrate before socket ready.
    void read(entry)
      .then((snapshot) => applyRead(entry, snapshot))
      .catch((error) =>
        publish(entry, {
          error: error instanceof Error ? error.message : 'Could not load saved state',
        }),
      )
    return () => {
      entry.listeners.delete(listener)
      if (--entry.retained === 0) {
        entry.stop?.()
        entry.stop = undefined
      }
    }
  },
  async ready(address: ViewStateAddress) {
    const entry = ensure(address)
    if (!entry.view.loaded) applyRead(entry, await read(entry))
    return entry.view
  },
  set(address: ViewStateAddress, value: ViewStateValues[keyof ViewStateValues] | null) {
    const entry = ensure(address)
    if (same(entry.view.value, value)) return
    entry.generation++
    entry.dirty = true
    publish(entry, { value, pending: true, error: null })
    schedule(entry)
  },
  acceptRemote(address: ViewStateAddress) {
    const entry = ensure(address)
    if (!entry.view.conflict) return
    entry.dirty = false
    publish(entry, {
      value: entry.remote.value,
      revision: entry.remote.revision,
      pending: false,
      conflict: null,
      error: null,
    })
  },
  keepLocal(address: ViewStateAddress) {
    keepLocal(ensure(address))
  },
  flush(address: ViewStateAddress) {
    return flush(ensure(address))
  },
}
