import { useState } from 'react'
import { Download } from 'lucide-react'
import { Spinner } from '@localixai/kit/spinner'
import { StatusDot } from '@localixai/kit/status-dot'

import { restartToUpdate } from '@/features/chat/model/restartToUpdate'
import { useDesktopUpdate } from '@/shared/hooks/useDesktopUpdate'
import { RailButton } from './RailButton'

export function DesktopUpdateButton() {
  const { state, applyUpdate } = useDesktopUpdate()
  const [applying, setApplying] = useState(false)

  // Nothing to show until an update is available.
  if (!state?.available) return null

  // While applying (Tauri: updater_install), progress events rewrite
  // state.message with a live "Downloading update… N%" — surface it through the
  // icon button's accessible name and styled hint so the download isn't silent.
  const label =
    applying && state.message.startsWith('Downloading')
      ? state.message
      : `Update & Restart${state.latestVersion ? ` (v${state.latestVersion})` : ''}`

  return (
    <RailButton
      icon={
        applying ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <>
            <Download className="h-4 w-4 text-foreground" />
            <StatusDot className="absolute right-2 top-2 bg-foreground" />
          </>
        )
      }
      label={label}
      active={false}
      // Warns first when the restart would stop a running turn or background job.
      onClick={() => void restartToUpdate(applyUpdate, setApplying)}
      disabled={applying}
      className="disabled:cursor-default"
    />
  )
}
