import { useEffect, useEffectEvent } from 'react'
import { tauriListen } from '@/shared/lib/tauri'

/**
 * Subscribe to one Rust-emitted event for the lifetime of the component. Outside the desktop
 * shell it is a no-op. The handler always sees the latest props, and an unmount that races the
 * asynchronous `listen` still releases the subscription.
 */
export function useTauriEvent(name: string, handler: (payload: unknown) => void) {
  const onEvent = useEffectEvent(handler)
  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    void tauriListen()?.(name, (event) => onEvent(event.payload))
      .then((dispose) => {
        if (disposed) dispose()
        else stop = dispose
      })
      .catch((error) => console.warn(`[tauri] could not listen to ${name}`, error))
    return () => {
      disposed = true
      stop?.()
    }
  }, [name])
}
