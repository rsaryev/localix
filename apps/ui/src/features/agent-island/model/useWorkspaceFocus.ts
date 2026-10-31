import { useEffect, useState } from 'react'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { useTauriEvent } from '@/shared/hooks/useTauriEvent'

/** True while a Localix workspace window is focused; the app itself then shows attention. */
export function useWorkspaceFocus() {
  // Until the shell answers, assume the app has the focus: a request must not unfold over Localix
  // (and count as shown) just because the first read is still in flight.
  const [focused, setFocused] = useState(
    () => platformCapabilities().desktop.invoker() !== undefined,
  )
  useEffect(() => {
    let disposed = false
    void platformCapabilities()
      .desktop.invoker()?.('island_workspace_focus')
      .then((value) => {
        if (!disposed && typeof value === 'boolean') setFocused(value)
      })
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [])
  useTauriEvent('island-workspace-focus', (value) => {
    if (typeof value === 'boolean') setFocused(value)
  })
  return focused
}
