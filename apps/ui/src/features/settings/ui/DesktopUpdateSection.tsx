import { useState } from 'react'
import { Button } from '@localixai/kit/button'
import { restartToUpdate } from '@/features/chat/model/restartToUpdate'
import {
  checkDesktopUpdate,
  hasDesktopUpdater,
  useDesktopUpdate,
} from '@/shared/hooks/useDesktopUpdate'
import { SettingsRow, SettingsRows, SettingsSection } from './SettingsScaffold'
import { SettingsActionActivity } from './SettingsActionActivity'

/**
 * Settings → General → Updates: the running version, an explicit check, and the install.
 *
 * Before this the only update surface was a rail button that appears once an hourly background
 * poll finds something, so there was no way to ask "is there an update?" and no place that said
 * which version was running. The check goes through the same `checkDesktopUpdate` the poll uses
 * and publishes to the same state, so the rail button lights up from a check made here. Rendered
 * only where a shell updater exists; a browser or a bridge-less shell has nothing to ask.
 */
export function DesktopUpdateSection() {
  if (!hasDesktopUpdater()) return null
  return (
    <SettingsSection
      anchor="general-updates"
      title="Updates"
      description="Localix checks for a signed update in the background. Check now, or restart into one that is ready."
    >
      <SettingsRows>
        <DesktopUpdateRow />
      </SettingsRows>
    </SettingsSection>
  )
}

function DesktopUpdateRow() {
  // The rail owns the poll and the progress listener; this reader shares their state.
  const { state, applyUpdate } = useDesktopUpdate({ poll: false })
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = async () => {
    setChecking(true)
    setError(null)
    const result = await checkDesktopUpdate()
    if (!result.ok) setError(result.error)
    setChecking(false)
  }

  // Shared with the composer strip and the rail, which can start the same install.
  const applying = state?.installing ?? false
  const version = state?.currentVersion ? `Localix ${state.currentVersion}` : 'Localix'
  const summary = state ? state.message : 'Not checked yet in this window.'

  return (
    <SettingsRow layout="responsive">
      <div className="space-y-1">
        <p className="text-sm font-normal text-foreground">{version}</p>
        <p className="text-sm text-text-faint" aria-live="polite">
          {summary}
        </p>
        {error && (
          <p role="alert" className="text-sm text-status-error">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="xl"
          aria-busy={checking || undefined}
          disabled={checking || applying}
          onClick={() => void check()}
        >
          {checking ? <SettingsActionActivity label="Checking" /> : 'Check for updates'}
        </Button>
        {state?.available && (
          <Button
            variant="mono"
            size="xl"
            aria-busy={applying || undefined}
            disabled={applying}
            // Warns first when the restart would stop a running turn or background job.
            onClick={() => void restartToUpdate(applyUpdate, () => {})}
          >
            {applying ? <SettingsActionActivity label="Installing" /> : 'Restart to update'}
          </Button>
        )}
      </div>
    </SettingsRow>
  )
}
