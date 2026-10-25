import { createContext, useCallback, useContext, useState } from 'react'

/**
 * What a page of the Store keeps while another page is open over it: a package's page replaces
 * the list it was opened from, and Back must find the list as it was left — its category, its
 * source. One map per open Store, provided by `StoreView`.
 */
export const StoreMemoryContext = createContext<Map<string, unknown>>(new Map())

/** State that outlives the part holding it, for as long as the Store is open. */
export function useRemembered<T>(key: string, initial: T): [T, (next: T) => void] {
  const memory = useContext(StoreMemoryContext)
  const [value, setValue] = useState<T>(() => (memory.has(key) ? (memory.get(key) as T) : initial))
  const set = useCallback(
    (next: T) => {
      memory.set(key, next)
      setValue(next)
    },
    [memory, key],
  )
  return [value, set]
}
