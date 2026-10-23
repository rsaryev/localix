import { lazy, Suspense, useState } from 'react'
import { loadString, saveString } from '@localixai/mini-app-sdk/ui/storage'
import { useDesktopUpdate } from '@/shared/hooks/useDesktopUpdate'
import { useSetupOpen } from '@/shared/lib/setupDialog'
import { restartToUpdate } from '../../model/restartToUpdate'

// The dialog, its scene and its stylesheet load only when there is a version to announce, so
// the startup bundle (`check:ui-startup`) carries this stub alone.
const UpdateDialog = lazy(() => import('./UpdateDialog'))

/** The last version the dialog was shown for. Remembered across launches. */
export const ANNOUNCED_KEY = 'localix.update.announced'

/**
 * Announces a newly found version once, in a dialog. Closing it — Later, Escape or the close
 * button — only ends the announcement: the titlebar button and the composer strip still offer
 * the update. A newer version is a new announcement. A version whose composer notice was hidden
 * is not announced either: the person has already said they know.
 */
export function UpdateAnnouncement() {
  const { state, applyUpdate, noticeDismissed } = useDesktopUpdate({ poll: false })
  const [announced, setAnnounced] = useState(() => loadString(ANNOUNCED_KEY))
  // Setup goes first on a first run: the announcement waits for it to close.
  const setupOpen = useSetupOpen()
  const version = state?.latestVersion ?? null
  if (!state?.available || state.installing || !version) return null
  if (version === announced || noticeDismissed || setupOpen) return null

  const close = () => {
    saveString(ANNOUNCED_KEY, version)
    setAnnounced(version)
  }
  return (
    <Suspense fallback={null}>
      <UpdateDialog
        state={state}
        onLater={close}
        onInstall={() => {
          // Closed first: a restart that would stop running work asks in a dialog of its own.
          close()
          void restartToUpdate(applyUpdate, () => {})
        }}
      />
    </Suspense>
  )
}
