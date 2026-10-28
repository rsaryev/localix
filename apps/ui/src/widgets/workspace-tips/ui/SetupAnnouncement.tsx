import { lazy, Suspense, useEffect } from 'react'
import { loadString } from '@localixai/mini-app-sdk/ui/storage'
import { openSetup, SETUP_DONE_KEY, useSetupOpen } from '@/shared/lib/setupDialog'

// The dialog, the carousel and every scene's stylesheet load only when setup opens, so the
// startup bundle (`check:ui-startup`) carries this stub alone.
const SetupDialog = lazy(() => import('./SetupDialog'))

/** Whether setup opens by itself at launch: until it has been closed once, on this device. */
export function opensAtLaunch(): boolean {
  return loadString(SETUP_DONE_KEY) === null
}

let decided = false

/** The setup dialog: at launch until it is closed once, and whenever the palette asks for it. */
export function SetupAnnouncement() {
  // Decided once per window, when the first one mounts; later renders only follow the shared state.
  useEffect(() => {
    if (decided) return
    decided = true
    if (opensAtLaunch()) openSetup()
  }, [])
  const open = useSetupOpen()
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <SetupDialog />
    </Suspense>
  )
}

/** Tests only: decide again on the next render. */
export function resetSetupLaunchForTest(): void {
  decided = false
}
