import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { ViewStateAddress } from '@localixai/api/client'
import { viewStateStore } from './store'

const EMPTY = {
  value: null,
  revision: 0,
  loaded: true,
  pending: false,
  conflict: null,
  error: null,
} as const
/** A typed record on the existing transport; no new socket or event bus. */
export function useViewState(address: ViewStateAddress | null) {
  const kind = address?.kind
  const key = address?.key
  const stable = useMemo(() => (kind && key ? { kind, key } : null), [kind, key])
  const subscribe = useCallback(
    (listener: () => void) => (stable ? viewStateStore.subscribe(stable, listener) : () => {}),
    [stable],
  )
  const snapshot = useCallback(() => (stable ? viewStateStore.snapshot(stable) : EMPTY), [stable])
  const state = useSyncExternalStore(subscribe, snapshot, snapshot)
  return { ...state, address: stable }
}
