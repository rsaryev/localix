import { useCallback, useState } from 'react'

const KEY = 'store:sidebar-folded'

/** The person's own choice, kept per browser; null when they have not made one. */
export function readFold(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()) {
  try {
    const raw = storage?.getItem(KEY)
    return raw === 'folded' ? true : raw === 'open' ? false : null
  } catch {
    return null
  }
}

function safeStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/**
 * Whether the Store's sidebar is folded to icons: open until the person presses the fold row, then
 * their choice holds at every width the sidebar is shown (a narrow pane has a select instead).
 */
export function useSidebarFold(storage = safeStorage()) {
  const [chosen, setChosen] = useState<boolean | null>(() => readFold(storage))
  const folded = chosen ?? false
  const toggle = useCallback(() => {
    setChosen(!folded)
    try {
      storage?.setItem(KEY, folded ? 'open' : 'folded')
    } catch {
      // The choice still holds for this session.
    }
  }, [folded, storage])
  return { folded, toggle }
}
