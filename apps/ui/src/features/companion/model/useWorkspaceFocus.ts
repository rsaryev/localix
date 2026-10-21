import { useEffect, useState } from 'react'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { useTauriEvent } from '@/shared/hooks/useTauriEvent'

/** True while a Localix workspace window is focused; the app itself then shows attention. */
export function useWorkspaceFocus() {
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    let disposed = false
    void platformCapabilities()
      .desktop.invoker()?.('companion_workspace_focus')
      .then((value) => {
        if (!disposed && typeof value === 'boolean') setFocused(value)
      })
      .catch(() => {})
    return () => {
      disposed = true
    }
  }, [])
  useTauriEvent('companion-workspace-focus', (value) => {
    if (typeof value === 'boolean') setFocused(value)
  })
  return focused
}
