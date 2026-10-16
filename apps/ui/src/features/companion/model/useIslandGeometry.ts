import { useEffect, useState } from 'react'
import { tauriInvoke } from '@/shared/lib/tauri'
import { useTauriEvent } from '@/shared/hooks/useTauriEvent'
import { isIslandGeometry, PREVIEW_GEOMETRY } from './geometry'

/** The host's measured cutout, re-sent when displays change; the preview keeps the fallback. */
export function useIslandGeometry() {
  const [geometry, setGeometry] = useState(PREVIEW_GEOMETRY)
  useEffect(() => {
    let alive = true
    void tauriInvoke()?.('companion_geometry')
      .then((value) => {
        if (alive && isIslandGeometry(value)) setGeometry(value)
      })
      .catch((error) => console.warn('[agent-island] geometry unavailable', error))
    return () => {
      alive = false
    }
  }, [])
  useTauriEvent('companion-geometry', (value) => {
    if (isIslandGeometry(value)) setGeometry(value)
  })
  return {
    geometry,
    nativeMaterial: Boolean(geometry.nativeMaterial),
    nativePointer: Boolean(geometry.nativePanel),
    notchHeight: geometry.notchHeight,
    hasNotch: geometry.notchWidth > 0,
  }
}
